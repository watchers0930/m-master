/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 공유예산 계정 단위 재전송 금지(핫픽스 round 1 I-1, 재검토 M4): 다른 제안의 생성 POST 원장 행이 'sent'로 남은 경우(보낸 뒤 프로세스가 죽음 —
// 결과를 모름)도 '불확실'이다. 다른 제안이 같은 계정에 적용해도 POST 0, apply_failed uncertain:shared_budget + 알림.
// 훅은 기록만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

test('an orphan sent shared-budget create of another proposal blocks creation account-wide', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async () => {
  const a = await setupApplyEnv(packageDir);
  const { env, naver, approved, apply } = a;
  const { client } = env;
  try {
    assert.equal((await a.account()).sharedBudgetId, null, '연결은 공유예산을 만들지 않았다');
    const x = await approved();
    // X의 생성 POST: 원장에 'sent'만 남고 결과 기록 전에 죽은 상태(네이버 반영 여부 모름)
    await client.adOperationLog.create({ data: {
      ownerId: 'owner', adAccountId: a.accountId, proposalId: x.id, step: 'shared_budget', method: 'POST', path: '/ncc/shared-budgets', requestHash: 'orphan',
    } });
    assert.equal((await client.adOperationLog.findFirstOrThrow({ where: { proposalId: x.id } })).status, 'sent');
    const y = await approved();
    const r = await apply(y.id);
    assert.deepEqual([r.status, r.body.data?.status, r.body.data?.failCode], [200, 'apply_failed', 'uncertain:shared_budget'], JSON.stringify(r.body));
    assert.equal(naver.state.calls.filter((c) => c.method === 'POST' && c.path === '/ncc/shared-budgets').length, 0, '공유예산 POST 0');
    assert.equal(naver.state.sharedBudgets.length, 0);
    assert.equal((await a.account()).sharedBudgetId, null);
    const alerts = await client.adAlert.findMany({ where: { type: 'ads.drift', adAccountId: a.accountId } });
    assert.ok(alerts.some((al) => al.payload.reason === 'uncertain' && al.payload.proposalId === y.id && al.payload.step === 'shared_budget'), JSON.stringify(alerts.map((al) => al.payload)));
    const camp = await client.adCampaign.findFirstOrThrow({ where: { proposalId: y.id } });
    assert.equal(naver.state.campaigns.find((c) => c.nccCampaignId === camp.naverId).userLock, true, 'Y의 캠페인은 꺼진 채');
  } finally {
    delete process.env.ADS_EXECUTION_ENABLED;
    await env.close();
  }
});
