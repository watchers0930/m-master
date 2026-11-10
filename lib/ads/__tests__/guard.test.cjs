/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Request */
// 감시·동기화 크론 순수 단위(Task 11): 크론 인증 래퍼(CRON_SECRET만 — 파이프라인 스위치와 무관), 30분 실행 칸, KST 0시 경계.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
// 순수 단위: 세션·DB 모듈은 쓰지 않는다(불리면 실패하도록 함정)
const trap = new Proxy({}, { get: () => { throw new Error('db must not be touched'); } });
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => { throw new Error('Unauthorized'); } } };
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: trap } };
const { adsCronRequest } = require('../cron-http.ts');
const { guardSlot, kstDayStart } = require('../guard.ts');

const req = (qs = '', auth) => new Request(`http://localhost/api/cron/ads-guard${qs}`, { headers: auth ? { authorization: auth } : {} });

test('adsCronRequest checks only CRON_SECRET (pipeline switch off still runs) and strips nothing secret', async () => {
  const saved = { c: process.env.CRON_SECRET, p: process.env.PIPELINE_AUTOMATION_ENABLED, e: process.env.ADS_EXECUTION_ENABLED };
  try {
    process.env.CRON_SECRET = 'unit-cron-secret-000000001';
    process.env.PIPELINE_AUTOMATION_ENABLED = 'false';
    delete process.env.ADS_EXECUTION_ENABLED;
    let ran = 0;
    const work = async () => { ran++; return { ok: true }; };
    for (const auth of [undefined, 'Bearer wrong', 'unit-cron-secret-000000001', 'Bearer unit-cron-secret-0000000011']) {
      const res = await adsCronRequest(req('', auth), work);
      assert.equal(res.status, 401, String(auth));
    }
    assert.equal(ran, 0, '인증 실패면 작업을 시작하지 않는다');
    let res = await adsCronRequest(req('?owner_id=x', 'Bearer unit-cron-secret-000000001'), work);
    assert.equal(res.status, 400, '알 수 없는 쿼리는 거부');
    assert.equal(ran, 0);
    res = await adsCronRequest(req('', 'Bearer unit-cron-secret-000000001'), work);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { data: { ok: true } });
    assert.equal(ran, 1, '파이프라인 스위치·비상 정지와 무관하게 실행');
    delete process.env.CRON_SECRET;
    res = await adsCronRequest(req('', 'Bearer undefined'), work);
    assert.equal(res.status, 401, 'CRON_SECRET이 없으면 거부(fail-closed)');
    res = await adsCronRequest(req('', 'Bearer '), work);
    assert.equal(res.status, 401);
    process.env.CRON_SECRET = 'unit-cron-secret-000000001';
    res = await adsCronRequest(req('', 'Bearer unit-cron-secret-000000001'), async () => { throw new Error('boom with secret-ish detail'); });
    assert.equal(res.status, 500);
    assert.equal((await res.text()).includes('secret-ish'), false, '내부 오류 원문을 싣지 않는다');
  } finally {
    for (const [k, v] of [['CRON_SECRET', saved.c], ['PIPELINE_AUTOMATION_ENABLED', saved.p], ['ADS_EXECUTION_ENABLED', saved.e]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('guard slot is the UTC 30-minute bucket; KST day starts at 15:00Z', () => {
  assert.equal(guardSlot(new Date('2026-03-10T05:00:00Z')), '2026-03-10T05:00');
  assert.equal(guardSlot(new Date('2026-03-10T05:29:59.999Z')), '2026-03-10T05:00');
  assert.equal(guardSlot(new Date('2026-03-10T05:30:00Z')), '2026-03-10T05:30');
  assert.equal(guardSlot(new Date('2026-03-10T23:59:59Z')), '2026-03-10T23:30');
  assert.equal(kstDayStart(new Date('2026-03-10T14:59:59Z')).toISOString(), '2026-03-09T15:00:00.000Z', 'KST 23:59:59 → 그날 0시');
  assert.equal(kstDayStart(new Date('2026-03-10T15:00:00Z')).toISOString(), '2026-03-10T15:00:00.000Z', 'KST 다음 날 0시 정각');
  assert.throws(() => guardSlot(new Date('x')));
});
