/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 키워드 씨앗 수집 — 실DB(PGlite): 유효한 수동 씨앗이 있으면 수동만(권위), 없으면 SEO > 최신 완료 컨설팅, 정제·중복 제거, 최대 25개,
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

    await t.test('manual seeds are authoritative: with ≥1 valid manual seed, SEO and strategy seeds are not added', async () => {
      const out = await collectSeeds('owner', mine.id, [' 비회원 등기감시 ', 'vestra', '!!', '전세사기']);
      assert.deepEqual(out, ['비회원등기감시', 'vestra', '전세사기']);
      assert.deepEqual(await collectSeeds('owner', mine.id, ['전세사기', '등기부등본', '전세 보증금', '전세사기 예방', '부동산 권리분석']),
        ['전세사기', '등기부등본', '전세보증금', '전세사기예방', '부동산권리분석'], '실운영 입력(2026-11-11): 도메인 풀이 섞이지 않는다');
      assert.deepEqual(await collectSeeds('owner', mine.id, ['!!', '   ']), ['전세보증금', '전세사기', 'VESTRA', '반환보증', '임대차분쟁', '깡통전세'],
        '정제 후 유효한 수동 씨앗이 0개면 도메인 풀을 쓴다');
    });

    await t.test('no manual seeds: domain pool priority SEO (volume desc) > latest completed strategy, deduped and sanitized', async () => {
      assert.deepEqual(await collectSeeds('owner', mine.id, []), ['전세보증금', '전세사기', 'VESTRA', '반환보증', '임대차분쟁', '깡통전세']);
    });

    await t.test('result is capped at 25', async () => {
      const manual = Array.from({ length: 24 }, (_, i) => `수동${i}`);
      assert.deepEqual(await collectSeeds('owner', mine.id, manual), manual, '수동 24개면 25번째를 도메인으로 채우지 않는다');
      const flood = await collectSeeds('owner', mine.id, Array.from({ length: 60 }, (_, i) => `많이${i}`));
      assert.equal(flood.length, 25);
      assert.ok(flood.every((s) => s.startsWith('많이')));
      const pool = await client.domain.create({ data: { ownerId: 'owner', url: 'pool.example' } });
      for (let i = 0; i < 30; i++) await seo(pool.id, `풀${i}`, 1000 - i);
      const fromPool = await collectSeeds('owner', pool.id, []);
      assert.deepEqual(fromPool, Array.from({ length: 25 }, (_, i) => `풀${i}`));
    });

    await t.test("another owner's domain yields no stored seeds (IDOR)", async () => {
      assert.deepEqual(await collectSeeds('owner', theirs.id, []), []);
      assert.deepEqual(await collectSeeds('owner', theirs.id, ['내입력']), ['내입력']);
      assert.deepEqual(await collectSeeds('other', mine.id, []), [], 'other owner gets nothing from my domain, even a report row carrying its ownerId');
      assert.deepEqual(await collectSeeds('owner', 'not-a-domain', []), []);
    });

    await t.test('SEO read is bounded by take 50 (rows beyond the bound are never read)', async () => {
      const big = await client.domain.create({ data: { ownerId: 'owner', url: 'big.example' } });
      // 검색량 상위 50개는 정제에서 모두 탈락하는 키워드, 51번째(가장 낮은 검색량)만 유효 → take 50이면 0건이어야 한다
      for (let i = 0; i < 50; i++) await seo(big.id, `특수!${i}`, 10000 - i);
      await seo(big.id, '오십일번째', 1);
      assert.deepEqual(await collectSeeds('owner', big.id, []), []);
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
