/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, exports, crypto */
const assert = require("node:assert/strict");
exports.reviewChecks = async (t, client, { owner, queries }) => {
  const { taskResult, markTask } = require("../tasks.ts");
  const { rankPlans } = require("../plan.ts");
  const { releaseKeywordReservations } = require("../reservations.ts");
  const { lockOwner } = require("../../visibility/queries.ts");
  const { checkpointSchema } = require("../adapters/types.ts");
  const { listRankings, getAudit } = require("../data.ts");
  const { rankingListSchema } = require("../../../schemas/seo.ts");
  const domain = await client.domain.create({
    data: { ownerId: owner, url: "review.example.com" },
  });
  const audit = await client.seoAudit.create({
    data: {
      domainId: domain.id,
      scope: "ranking",
      runKey: crypto.randomUUID(),
      configHash: "review",
      frozenConfig: {},
    },
  });
  const createTask = (itemKey, extra = {}) =>
    client.seoTask.create({
      data: {
        auditId: audit.id,
        ownerId: owner,
        operation: "keywords_for_site",
        itemKey,
        runKey: audit.runKey,
        frozenInput: {},
        status: "submitted",
        claimVersion: 1,
        leaseUntil: new Date(Date.now() + 300000),
        ...extra,
      },
    });
  try {
    await t.test(
      "100 metrics and observations use bounded writes; duplicate inputs, zero volume, replay and older ranks remain correct",
      async () => {
        const task = await createTask("bulk");
        const observedAt = new Date(Date.now() - 10000).toISOString();
        const result = checkpointSchema.parse({
          observedAt,
          metrics: Array.from({ length: 100 }, (_, i) => ({
            keyword: `metric-${i}`,
            engine: "google",
            searchVolume: i,
            volumeScale: null,
            volumePeriod: null,
            competition: null,
            competitionRaw: null,
          })),
          observations: Array.from({ length: 100 }, (_, i) => ({
            keyword: `metric-${i}`,
            engine: "google",
            source: "serp",
            rank: 15,
            rankAbsolute: 20,
            matchedUrl: "https://review.example.com",
            status: "ranked",
            returnedRange: 100,
            sourceObservedAt: null,
          })),
        });
        const before = queries.length;
        await taskResult(task, result);
        const writes = queries
          .slice(before)
          .filter((q) => /^(INSERT|UPDATE)/i.test(q));
        assert.ok(
          writes.length <= 6,
          `expected bounded batch writes, got ${writes.length}`,
        );
        assert.equal(
          await client.seoRanking.count({ where: { domainId: domain.id } }),
          100,
        );
        const keyword = await client.seoKeyword.findFirst({
          where: { domainId: domain.id, keyword: "metric-0" },
        });
        assert.equal(keyword.searchVolume, 0);
        assert.equal(keyword.rank, 15);
        assert.equal(keyword.reservationOnly, false);
        // A new task replaying this audit's snapshot must preserve its original rank.
        const replay = await createTask("replay");
        const changed = checkpointSchema.parse({
          ...result,
          metrics: [],
          observations: [
            { ...result.observations[0], rank: 99 },
            { ...result.observations[0], rank: 88 },
          ],
        });
        await taskResult(replay, changed);
        assert.equal(
          (await client.seoKeyword.findUnique({ where: { id: keyword.id } }))
            .rank,
          15,
        );
        // An older checkpoint cannot roll back a newer cached direct rank.
        await client.seoKeyword.update({
          where: { id: keyword.id },
          data: { rank: 3, rankObservedAt: new Date() },
        });
        const older = await createTask("older");
        await taskResult(older, changed);
        assert.equal(
          (await client.seoKeyword.findUnique({ where: { id: keyword.id } }))
            .rank,
          3,
        );
        const input = rankingListSchema.parse({
          domainId: domain.id,
          limit: 100,
        });
        const page = await listRankings(owner, { ...input, limit: 25 });
        const next = await listRankings(owner, {
          ...input,
          limit: 100,
          cursor: page.nextCursor,
        });
        assert.equal(
          new Set([...page.items, ...next.items].map((r) => r.id)).size,
          100,
        );
        assert.equal(next.items.length, 75);
        await client.$executeRawUnsafe("SET enable_seqscan = off");
        try {
          const explain = await client.$queryRawUnsafe(
            "EXPLAIN SELECT id FROM seo_rankings WHERE domain_id = $1 ORDER BY captured_at DESC, id ASC LIMIT 26",
            domain.id,
          );
          assert.match(
            JSON.stringify(explain),
            /seo_rankings_domain_id_captured_at_id_idx/,
          );
        } finally {
          await client.$executeRawUnsafe("RESET enable_seqscan");
        }
      },
    );
    await t.test(
      "failed reservations release capacity, shared active tasks keep it, real results survive cleanup",
      async () => {
        // Leave capacity for another engine's reservation.
        await client.seoKeyword.deleteMany({
          where: { domainId: domain.id, keyword: { not: "metric-0" } },
        });
        const source = await client.seoKeyword.findFirst({
          where: { domainId: domain.id },
        });
        const plans = await client.$transaction(async (tx) => {
          await lockOwner(tx, owner);
          return rankPlans(
            tx,
            owner,
            {
              domainId: domain.id,
              host: "review.example.com",
              market: "ko-KR",
              scope: "ranking",
              runKey: audit.runKey,
              engines: ["naver"],
              keywordIds: [source.id],
              requestedPages: null,
              autoRankings: false,
            },
            "starter",
          );
        });
        const reservationId = plans[0].frozenInput.reservedKeywordId;
        assert.ok(reservationId);
        const first = await createTask("reservation-first", {
          operation: "serp_naver",
          frozenInput: plans[0].frozenInput,
        });
        const second = await createTask("reservation-shared", {
          operation: "serp_naver",
          frozenInput: plans[0].frozenInput,
        });
        await markTask(first, "failed", "debug");
        assert.ok(
          await client.seoKeyword.findUnique({ where: { id: reservationId } }),
        );
        await markTask(second, "uncertain", "submission_uncertain");
        assert.equal(
          await client.seoKeyword.findUnique({ where: { id: reservationId } }),
          null,
        );
        const dto = await getAudit(owner, audit.id);
        assert.equal(
          JSON.stringify(dto).includes("submission_uncertain"),
          false,
        );
        assert.equal(JSON.stringify(dto).includes('"debug"'), false);
        // A late worker must not release a reservation still owned by a newer claim.
        const reserved = await client.seoKeyword.create({
          data: {
            domainId: domain.id,
            keyword: "late",
            normalizedKeyword: "late",
            engine: "naver",
            reservationOnly: true,
          },
        });
        const live = await createTask("live", {
          operation: "serp_naver",
          frozenInput: { reservedKeywordId: reserved.id },
          claimVersion: 2,
        });
        await markTask({ ...live, claimVersion: 1 }, "failed", "stale");
        assert.ok(
          await client.seoKeyword.findUnique({ where: { id: reserved.id } }),
        );
        await markTask(live, "failed", "failed");
        const valuable = await client.seoKeyword.create({
          data: {
            domainId: domain.id,
            keyword: "zero",
            normalizedKeyword: "zero",
            engine: "naver",
            reservationOnly: true,
            searchVolume: 0,
          },
        });
        await client.$transaction(async (tx) => {
          await lockOwner(tx, owner);
          await releaseKeywordReservations(tx, domain.id);
        });
        assert.ok(
          await client.seoKeyword.findUnique({ where: { id: valuable.id } }),
        );
        assert.ok(
          await client.seoKeyword.findUnique({ where: { id: source.id } }),
        );
      },
    );
    await t.test(
      "abandoned unsubmitted plans expire after 24h; paid, checkpointed and recently active tasks remain protected",
      async () => {
        const {
          expireAbandonedAudit,
          ABANDONED_AUDIT_MS,
        } = require("../reservations.ts");
        const old = new Date(Date.now() - ABANDONED_AUDIT_MS - 10000);
        const staleAudit = await client.seoAudit.create({
          data: {
            domainId: domain.id,
            scope: "ranking",
            runKey: crypto.randomUUID(),
            configHash: "expired",
            frozenConfig: { autoRankings: true },
            createdAt: old,
          },
        });
        const reserved = await client.seoKeyword.create({
          data: {
            domainId: domain.id,
            keyword: "abandoned",
            normalizedKeyword: "abandoned",
            engine: "naver",
            reservationOnly: true,
          },
        });
        const stale = await client.seoTask.create({
          data: {
            auditId: staleAudit.id,
            ownerId: owner,
            operation: "serp_naver",
            itemKey: "expire",
            runKey: staleAudit.runKey,
            frozenInput: { reservedKeywordId: reserved.id },
            createdAt: old,
            updatedAt: old,
            reservedKrw: 10,
          },
        });
        const expire = () =>
          client.$transaction(async (tx) => {
            await lockOwner(tx, owner);
            await expireAbandonedAudit(tx, owner, domain.id);
            await releaseKeywordReservations(tx, domain.id);
          });
        // Check each exclusion independently against the same old plan.
        for (const protection of [
          { status: "submitted" },
          { vendorTaskId: "paid-protected" },
          { costKrw: 1 },
          { status: "claimed" },
          { resultCheckpoint: {} },
          { updatedAt: new Date() },
        ]) {
          await client.seoTask.update({
            where: { id: stale.id },
            data: {
              ...protection,
              ...(protection.updatedAt ? {} : { updatedAt: old }),
            },
          });
          await expire();
          assert.equal(
            (await client.seoAudit.findUnique({ where: { id: staleAudit.id } }))
              .status,
            "pending",
          );
          assert.ok(
            await client.seoKeyword.findUnique({ where: { id: reserved.id } }),
          );
          const { Prisma } = require("@prisma/client");
          await client.seoTask.update({
            where: { id: stale.id },
            data: {
              status: "pending",
              vendorTaskId: null,
              costKrw: 0,
              claimVersion: 0,
              resultCheckpoint: Prisma.DbNull,
              updatedAt: old,
            },
          });
        }
        await client.seoTask.update({ where: { id: stale.id }, data: { claimVersion: 1, updatedAt: old } });
        await expire();
        const changed = await client.seoAudit.findUnique({
          where: { id: staleAudit.id },
        });
        assert.equal(changed.status, "failed");
        assert.equal(changed.frozenConfig.autoRankings, false);
        assert.equal(
          (await client.seoTask.findUnique({ where: { id: stale.id } }))
            .reservedKrw,
          0,
        );
        assert.equal(
          await client.seoKeyword.findUnique({ where: { id: reserved.id } }),
          null,
        );
      },
    );
  } finally {
    await client.domain.delete({ where: { id: domain.id } });
  }
};
