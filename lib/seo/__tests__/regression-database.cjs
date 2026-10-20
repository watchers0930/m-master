/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
exports.regressionChecks = async (t, client, { owner }) => {
  const { claimTasks, beginExecution } = require("../tasks.ts");
  const { resumeAudit } = require("../audit.ts");
  const { deleteDomain } = require("../../visibility/domains.ts");
  const { recoverExpired } = require("../pending.ts");
  const { lockOwner } = require("../../visibility/queries.ts");
  const domain = await client.domain.create({
    data: { ownerId: owner, url: "regression.example.com" },
  });
  const createAudit = (data = {}) =>
    client.seoAudit.create({
      data: {
        domainId: domain.id,
        scope: "full",
        runKey: crypto.randomUUID(),
        configHash: "regression",
        frozenConfig: { autoRankings: false },
        ...data,
      },
    });
  let pricing = process.env.SEO_VERIFIED_PRICING_JSON;
  try {
    await t.test(
      "real transaction rolls back earlier claim when second pricing validation fails; expired claims release reserves",
      async () => {
        const audit = await createAudit();
        const tasks = [];
        for (const operation of ["serp_google", "labs_ranked"])
          tasks.push(
            await client.seoTask.create({
              data: {
                auditId: audit.id,
                ownerId: owner,
                operation,
                itemKey: "-",
                runKey: audit.runKey,
                reservedKrw: 1,
                frozenInput: { host: domain.url, market: "ko-KR" },
              },
            }),
          );
        const config = JSON.parse(pricing);
        config.labs_ranked.verifiedAt = "2000-01-01";
        process.env.SEO_VERIFIED_PRICING_JSON = JSON.stringify(config);
        await assert.rejects(
          claimTasks(
            owner,
            tasks.map((v) => v.id),
          ),
          (e) => e.status === 429,
        );
        assert.deepEqual(
          await client.seoTask.findMany({
            where: { auditId: audit.id },
            orderBy: { operation: "asc" },
          }),
          tasks.sort((a, b) => a.operation.localeCompare(b.operation)),
        );
        process.env.SEO_VERIFIED_PRICING_JSON = pricing;
        const [claim] = await claimTasks(owner, [tasks[0].id]);
        await client.seoTask.update({
          where: { id: claim.id },
          data: { leaseUntil: new Date(0) },
        });
        await client.$transaction(async (tx) => {
          await lockOwner(tx, owner);
          await recoverExpired(tx, owner, audit.id);
        });
        const released = await client.seoTask.findUnique({
          where: { id: claim.id },
        });
        assert.equal(released.status, "pending");
        assert.equal(released.reservedKrw, 0);
        await assert.rejects(beginExecution(claim), (e) => e.status === 409);
        await client.seoAudit.delete({ where: { id: audit.id } });
      },
    );
    await t.test(
      "real multi-URL OnPage partial failure checkpoints all charges, exposes failed URL and never repurchases",
      async () => {
        const { executeTask } = require("../execute.ts");
        const { DataForSeoClient } = require("../../external/dataforseo.ts");
        const audit = await createAudit({
          scope: "technical",
          frozenConfig: {
            autoRankings: false,
            scope: "technical",
            requestedPages: 2,
          },
        });
        const task = await client.seoTask.create({
          data: {
            auditId: audit.id,
            ownerId: owner,
            operation: "onpage_instant",
            itemKey: "-",
            runKey: audit.runKey,
            reservedKrw: 10,
            frozenInput: {
              host: domain.url,
              market: "ko-KR",
              paths: ["/a", "/b"],
            },
          },
        });
        const [claim] = await claimTasks(owner, [task.id]);
        let calls = 0;
        const vendor = new DataForSeoClient(async () => {
          calls++;
          return Response.json({
            status_code: 20000,
            tasks: [
              {
                id: crypto.randomUUID(),
                status_code: 20000,
                cost: 0.001,
                data: { url: `https://${domain.url}/a` },
                result: [
                  {
                    items: [
                      {
                        url: `https://${domain.url}/a`,
                        status_code: 200,
                        meta: { title: "Title" },
                        checks: {},
                      },
                    ],
                  },
                ],
              },
              {
                id: crypto.randomUUID(),
                status_code: 40501,
                cost: 0.002,
                data: { url: `https://${domain.url}/b` },
                result: null,
              },
            ],
          });
        });
        await executeTask(claim, vendor);
        const row = await client.seoTask.findUnique({ where: { id: task.id } });
        assert.equal(row.status, "partial");
        assert.equal(row.reservedKrw, 0);
        assert.equal(
          row.costKrw,
          0.003 * Number(process.env.DATAFORSEO_USD_KRW ?? "1400"),
        );
        const dto = await resumeAudit(owner, audit.id);
        assert.equal(dto.status, "partial");
        assert.deepEqual(dto.tasks[0].failedUrls, [`https://${domain.url}/b`]);
        assert.equal(calls, 1);
        await client.seoAudit.delete({ where: { id: audit.id } });
      },
    );
    await t.test(
      "real budget denial skips automatic rankings and permits domain deletion after partial completion",
      async () => {
        const audit = await createAudit({
          frozenConfig: {
            domainId: domain.id,
            host: domain.url,
            market: "ko-KR",
            scope: "full",
            engines: ["google"],
            autoRankings: true,
          },
        });
        await client.seoTask.create({
          data: {
            auditId: audit.id,
            ownerId: owner,
            operation: "labs_ranked",
            itemKey: "-",
            runKey: audit.runKey,
            status: "completed",
            frozenInput: {},
          },
        });
        await client.seoKeyword.create({
          data: {
            domainId: domain.id,
            keyword: "regression",
            normalizedKeyword: "regression",
            engine: "google",
            lastAuditId: audit.id,
          },
        });
        const setting = await client.setting.findUnique({
          where: { ownerId: owner },
        });
        await client.setting.update({
          where: { ownerId: owner },
          data: { budgetMonthly: 0 },
        });
        try {
          const result = await resumeAudit(owner, audit.id);
          assert.equal(result.status, "partial");
          assert.ok(result.completedAt);
          assert.equal(
            result.tasks.find((v) => v.operation === "automatic_rankings")
              .status,
            "skipped",
          );
          const saved = await client.seoAudit.findUnique({
            where: { id: audit.id },
          });
          assert.equal(saved.frozenConfig.autoRankingsState, "skipped");
          await deleteDomain(owner, domain.id);
        } finally {
          await client.setting.update({
            where: { ownerId: owner },
            data: { budgetMonthly: setting.budgetMonthly },
          });
        }
      },
    );
    await t.test(
      "direct domain deletion expires legacy automatic intent even without a pending task",
      async () => {
        const d = await client.domain.create({
          data: { ownerId: owner, url: "legacy-regression.example.com" },
        });
        const old = new Date(Date.now() - 48 * 3600000);
        const a = await client.seoAudit.create({
          data: {
            domainId: d.id,
            scope: "full",
            runKey: crypto.randomUUID(),
            configHash: "legacy",
            frozenConfig: { autoRankings: true },
            createdAt: old,
          },
        });
        await client.seoTask.create({
          data: {
            auditId: a.id,
            ownerId: owner,
            operation: "labs_ranked",
            itemKey: "-",
            runKey: a.runKey,
            status: "completed",
            frozenInput: {},
            updatedAt: old,
          },
        });
        await deleteDomain(owner, d.id);
        assert.equal(
          await client.domain.findUnique({ where: { id: d.id } }),
          null,
        );
      },
    );
  } finally {
    process.env.SEO_VERIFIED_PRICING_JSON = pricing;
    await client.domain.deleteMany({ where: { id: domain.id } });
  }
};
