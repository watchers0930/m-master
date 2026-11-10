/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test helper. */
/* global require, module, process */
// 감시 크론(Task 11) DB 테스트 공용 준비: apply-env(PGlite + 가짜 네이버 + 실제 봉인 키 계정) + 적용 끝난 제안 n개(캠페인 n개).
// - 시각은 주입한다(runGuard(now)). D = 2026-03-10(KST). LOCK = D 14:00 KST, LAST = D 23:59:59 KST(14:59:59Z), NEXT = D+1 00:00 KST(15:00:00Z).
// - 성과는 날짜별 표(dailyStats)로 넣는다 — /stats timeRange의 KST 날짜가 맞아야 그 날 비용이 보인다.
// 가짜 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서. 반환된 close()를 finally에서 반드시 부른다.
const assert = require('node:assert/strict');
const { setupApplyEnv } = require('./apply-env.cjs');

const D = '2026-03-10', D1 = '2026-03-11';
const T = {
  LOCK: new Date('2026-03-10T05:00:00Z'), LOCK2: new Date('2026-03-10T05:30:00Z'),
  LAST: new Date('2026-03-10T14:59:59Z'), NEXT: new Date('2026-03-10T15:00:00Z'), NEXT2: new Date('2026-03-10T15:30:00Z'),
};

async function setupGuardEnv(packageDir, campaigns = 1) {
  const a = await setupApplyEnv(packageDir);
  try {
    const { client } = a.env;
    const S = a.naver.state;
    const camps = [];
    for (let i = 0; i < campaigns; i++) {
      const p = await a.approved();
      assert.equal((await a.apply(p.id)).body.data.status, 'applied');
      camps.push((await a.mirrors(p.id)).campaigns[0]);
    }
    const { runGuard } = require('../../guard.ts');
    const naverCamp = (naverId) => S.campaigns.find((c) => c.nccCampaignId === naverId);
    const row = (m) => client.adCampaign.findUniqueOrThrow({ where: { id: m.id } });
    // 대장이 켠 상태(네이버 켜짐 + 미러 lockedBy null)
    const launch = async (m) => {
      naverCamp(m.naverId).userLock = false;
      await client.adCampaign.update({ where: { id: m.id }, data: { userLock: false, lockedBy: null, lockVersion: { increment: 1 } } });
    };
    const daySpend = (day, byNaverId) => S.dailyStats.set(day, new Map(Object.entries(byNaverId).map(([id, salesAmt]) => [id, { salesAmt }])));
    const alerts = (type) => client.adAlert.findMany({ where: { type }, orderBy: { createdAt: 'asc' } });
    const resumePuts = (naverId) => S.calls.filter((c) => c.method === 'PUT' && c.path === `/ncc/campaigns/${naverId}` && c.body?.userLock === false).length;
    const pausePuts = (naverId) => S.calls.filter((c) => c.method === 'PUT' && c.path === `/ncc/campaigns/${naverId}` && c.body?.userLock === true).length;
    const close = async () => { delete process.env.ADS_EXECUTION_ENABLED; await a.env.close(); };
    return { ...a, S, camps, runGuard, naverCamp, row, launch, daySpend, alerts, resumePuts, pausePuts, close };
  } catch (error) {
    await a.env.close();
    throw error;
  }
}

module.exports = { setupGuardEnv, D, D1, T };
