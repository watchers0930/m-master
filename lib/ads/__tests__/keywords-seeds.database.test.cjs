/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 키워드 씨앗 수집 — 실DB(PGlite): 출처 우선순위(수동 > SEO > 최신 완료 컨설팅), 정제·중복 제거, 최대 25개,
// 최신 '완료' 리포트만, 다른 소유자의 도메인·리포트는 0건(IDOR).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupAdsDb } = require('./fixtures/ads-db.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('collectSeeds on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const env = await setupAdsDb(packageDir);
  try {
    const { client } = env;
    const { collectSeeds } = require('../keywords.ts');
    const mine = await client.domain.create({ data: { ownerId: 'owner', url: 'vestra.ai.kr' } });
    const empty = await client.domain.create({ data: { ownerId: 'owner', url: 'empty.example' } });
    const theirs = await client.domain.create({ data: { ownerId: 'other', url: 'other.example' } });
    let n = 0;
    const seo = (domainId, keyword, searchVolume, engine = 'google') => client.seoKeyword.create({
      data: { domainId, keyword, normalizedKeyword: `${keyword.toLowerCase()}-${++n}`, engine, searchVolume } });
    const report = (domainId, ownerId, status, keywords, at, schemaVersion = 'v2') => client.consultingReport.create({ data: {
      domainId, ownerId, status, schemaVersion, promptVersion: 'p1', model: 'gpt-4o', attemptId: `att-${++n}`,
      inputSnapshotHash: `hash-${n}`, createdAt: new Date(at),
      inputSnapshot: keywords === null ? { market: 'ko-KR' } : { market: 'ko-KR', structuredMetrics: { keywords: keywords.map((keyword, i) => ({ keywordId: `k${i}`, keyword })) } },
    } });
    await seo(mine.id, '전세사기', 900);
    await seo(mine.id, '전세 보증금', 1500);
    await seo(mine.id, '반환보증', null);
    await seo(mine.id, 'VESTRA', 50, 'naver');
    await seo(mine.id, '특수!문자', 5000);
    await seo(theirs.id, '남의키워드', 99999);
    await report(mine.id, 'owner', 'completed', ['오래된전략'], '2026-11-01T00:00:00Z');
    await report(mine.id, 'owner', 'completed', ['임대차분쟁', '전세사기', '깡통전세'], '2026-11-05T00:00:00Z');
    await report(mine.id, 'owner', 'generating', ['생성중전략'], '2026-11-08T00:00:00Z');
    await report(mine.id, 'owner', 'failed', ['실패전략'], '2026-11-09T00:00:00Z');
    await report(mine.id, 'other', 'completed', ['남의리포트'], '2026-11-10T00:00:00Z'); // 소유자 불일치 행(있어선 안 되지만 방어)
    await report(theirs.id, 'other', 'completed', ['남의전략'], '2026-11-10T00:00:00Z');

    await t.test('priority manual > SEO (volume desc) > latest completed strategy, deduped and sanitized', async () => {
      const out = await collectSeeds('owner', mine.id, [' 비회원 등기감시 ', 'vestra', '!!', '전세사기']);
      assert.deepEqual(out, ['비회원등기감시', 'vestra', '전세사기', '전세보증금', '반환보증', '임대차분쟁', '깡통전세']);
    });

    await t.test('result is capped at 25 with manual seeds first', async () => {
      const manual = Array.from({ length: 24 }, (_, i) => `수동${i}`);
      const out = await collectSeeds('owner', mine.id, manual);
      assert.equal(out.length, 25);
      assert.deepEqual(out.slice(0, 24), manual);
      assert.equal(out[24], '전세보증금');
      const flood = await collectSeeds('owner', mine.id, Array.from({ length: 60 }, (_, i) => `많이${i}`));
      assert.equal(flood.length, 25);
      assert.ok(flood.every((s) => s.startsWith('많이')));
    });

    await t.test("another owner's domain yields no stored seeds (IDOR)", async () => {
      assert.deepEqual(await collectSeeds('owner', theirs.id, []), []);
      assert.deepEqual(await collectSeeds('owner', theirs.id, ['내입력']), ['내입력']);
      assert.deepEqual(await collectSeeds('other', mine.id, []), [], 'other owner gets nothing from my domain, even a report row carrying its ownerId');
      assert.deepEqual(await collectSeeds('owner', 'not-a-domain', []), []);
    });

    await t.test('domain without SEO keywords or completed reports yields manual only; v1 snapshot has no strategy keywords', async () => {
      assert.deepEqual(await collectSeeds('owner', empty.id, ['직접']), ['직접']);
      await report(empty.id, 'owner', 'completed', null, '2026-11-09T00:00:00Z', 'v1');
      assert.deepEqual(await collectSeeds('owner', empty.id, []), []);
      await report(empty.id, 'owner', 'completed', ['새전략'], '2026-11-10T00:00:00Z');
      assert.deepEqual(await collectSeeds('owner', empty.id, []), ['새전략']);
    });
  } finally {
    await env.close();
  }
});
