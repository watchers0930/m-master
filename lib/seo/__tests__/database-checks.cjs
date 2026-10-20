/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, exports, crypto */
const assert = require("node:assert/strict");
exports.additionalChecks = async (
  t,
  client,
  { owner, domain, id, queries },
) => {
  const { runAudit } = require("../audit.ts");
  const { claimTask, markTask } = require("../tasks.ts");
  await t.test(
    "a different-key click within 60 seconds is rejected without creating another audit",
    async () => {
      const before = await client.seoAudit.count();
      await assert.rejects(
        runAudit(
          owner,
          { domainId: domain.id, runKey: crypto.randomUUID() },
          "full",
        ),
        (e) => e.status === 429,
      );
      assert.equal(await client.seoAudit.count(), before);
    },
  );
  await t.test(
    "downgrade blocks new submissions but permits recovery of an existing paid task",
    async () => {
      await client.user.update({
        where: { id: owner },
        data: { plan: "free" },
      });
      const base = {
        auditId: id,
        ownerId: owner,
        operation: "serp_google",
        runKey: crypto.randomUUID(),
        frozenInput: {
          host: "example.com",
          market: "ko-KR",
          keyword: "downgrade",
          engine: "google",
        },
      };
      const known = await client.seoTask.create({
        data: {
          ...base,
          itemKey: "downgrade-known",
          vendorTaskId: "downgrade-paid-id",
        },
      });
      const fresh = await client.seoTask.create({
        data: { ...base, itemKey: "downgrade-new", reservedKrw: 10 },
      });
      const claim = await claimTask(owner, known.id);
      assert.ok(claim);
      await assert.rejects(claimTask(owner, fresh.id), (e) => e.status === 403);
      await markTask(claim, "completed", "");
      await client.seoTask.update({
        where: { id: fresh.id },
        data: { status: "failed", reservedKrw: 0 },
      });
      await client.user.update({
        where: { id: owner },
        data: { plan: "starter" },
      });
    },
  );
  await t.test(
    "100 keywords use a fixed pair of reads; over-cap engine combinations are blocked before purchase",
    async () => {
      const { listKeywords } = require("../data.ts");
      const current = await client.seoKeyword.count({
        where: { domainId: domain.id },
      });
      await client.seoKeyword.createMany({
        data: Array.from({ length: 100 - current }, (_, index) => ({
          id: `clx${String(index).padStart(22, "0")}`,
          domainId: domain.id,
          keyword: `cap-${index}`,
          normalizedKeyword: `cap-${index}`,
          engine: "google",
        })),
      });
      const before = queries.length;
      const result = await listKeywords(owner, {
        domainId: domain.id,
        limit: 100,
      });
      assert.equal(result.items.length, 100);
      assert.equal(
        queries.slice(before).filter((q) => /^SELECT/i.test(q)).length,
        2,
      );
      await client.auditLog.updateMany({
        where: { actor: owner, action: "seo.audit.reserve" },
        data: { createdAt: new Date(Date.now() - 120000) },
      });
      const auditCount = await client.seoAudit.count(),
        ledgerCount = await client.costLedger.count();
      await assert.rejects(
        runAudit(
          owner,
          {
            domainId: domain.id,
            runKey: crypto.randomUUID(),
            keywordIds: ["clx0000000000000000000000"],
            engines: ["naver"],
          },
          "ranking",
        ),
        (e) => e.status === 429,
      );
      assert.equal(await client.seoAudit.count(), auditCount);
      assert.equal(await client.costLedger.count(), ledgerCount);
    },
  );
  await t.test(
    "monthly reservation quota survives history deletion and cannot be reset by a new domain",
    async () => {
      const other = await client.domain.create({
        data: { ownerId: owner, url: "quota.example.com" },
      });
      const existing = await client.auditLog.count({
        where: { actor: owner, action: "seo.audit.reserve" },
      });
      await client.auditLog.createMany({
        data: Array.from({ length: 10 - existing }, () => ({
          id: crypto.randomUUID(),
          actor: owner,
          action: "seo.audit.reserve",
          targetId: "deleted-domain",
          targetType: "domain",
        })),
      });
      await assert.rejects(
        runAudit(
          owner,
          { domainId: other.id, runKey: crypto.randomUUID() },
          "research",
        ),
        (e) => e.status === 429,
      );
      assert.equal(
        await client.seoAudit.count({ where: { domainId: other.id } }),
        0,
      );
      await client.domain.delete({ where: { id: other.id } });
    },
  );
};
