/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 공유예산 핫픽스(2026-11-11 실호출 400/1002, 대장 승인 설계 A) — 실DB(PGlite) + 가짜 네이버(캠페인 없는·deliveryMethod 없는 생성을 1002로 거부).
// - 연결은 공유예산을 만들지 않는다(sharedBudgetId null). 첫 적용이 캠페인(공유예산 없이·꺼짐) → POST mq-cap(campaignList=그 캠페인) → 계정에 저장.
// - 그 뒤 적용은 PUT ?fields=sharedBudget으로 붙인다. 붙인 뒤 캠페인·공유예산 재조회 대조. 불확실은 재전송 없이 대조만.
// - 비상 정지 스위치는 생성·붙이기 각각 직전에 확인. 공유예산 없는 계정의 new_campaign 적용은 한 번에 하나.
// 훅은 기록·장애 주입(상태 변경 포함)만 한다 — 단언은 훅 밖에서.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { json } = require('./fixtures/fake-naver.cjs');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;
const CUSTOMER = 1234567;

test('shared budget is created with the first applied campaign, later campaigns attach', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { env, naver, approved, apply, proposalRow, resetFaults } = a;
  const { client } = env;
  const S = naver.state;
  const budgetPosts = () => S.calls.filter((c) => c.method === 'POST' && c.path === '/ncc/shared-budgets');
  const attachPuts = () => S.calls.filter((c) => c.method === 'PUT' && /^\/ncc\/campaigns\//.test(c.path) && c.query.fields === 'sharedBudget');
  const campOf = async (pid) => (await client.adCampaign.findFirstOrThrow({ where: { proposalId: pid } })).naverId;
  const naverCamp = (id) => S.campaigns.find((c) => c.nccCampaignId === id);
  const ops = (pid, step) => client.adOperationLog.findMany({ where: { proposalId: pid, step }, orderBy: { createdAt: 'asc' } });
  const resetAccount = async () => { await client.adAccount.update({ where: { id: a.accountId }, data: { sharedBudgetId: null } }); S.sharedBudgets.length = 0; };
  try {
    await t.test('fake pins the live rejection: campaign-less or deliveryMethod-less create is 400/1002', async () => {
      assert.equal((await a.account()).sharedBudgetId, null, '연결은 공유예산을 만들지 않았다');
      assert.equal(budgetPosts().length, 0);
      // 연결 계정의 실제 클라이언트(서명 포함)로 보낸다 — 이 가짜 거부가 실운영 응답(400/1002)과 같다
      const { clientForAccount } = require('../../external/naver-searchad.ts');
      const client2 = clientForAccount(await a.account());
      for (const body of [{ customerId: CUSTOMER, name: 'x', ownerType: 'CAMPAIGN', dailyBudget: 10000 },
        { customerId: CUSTOMER, name: 'x', ownerType: 'CAMPAIGN', deliveryMethod: 'ACCELERATED', dailyBudget: 10000, campaignList: [] }]) {
        const err = await client2.post('/ncc/shared-budgets', body).then(() => null, (e) => e);
        assert.deepEqual([err?.reason, err?.naverCode], ['ads_rejected', 1002], JSON.stringify(body));
      }
      assert.equal(S.sharedBudgets.length, 0);
      S.calls.length = 0;
    });

    await t.test('first apply: campaign without budget, then POST mq-cap with that campaign; stored on the account', async () => {
      const p = await approved();
      const r = await apply(p.id);
      assert.deepEqual([r.status, r.body.data.status], [200, 'applied'], JSON.stringify(r.body));
      const id = await campOf(p.id);
      const campPost = S.calls.find((c) => c.method === 'POST' && c.path === '/ncc/campaigns');
      assert.equal(Object.hasOwn(campPost.body, 'sharedBudgetId'), false, '캠페인 생성 본문에 공유예산 없음');
      const order = S.calls.filter((c) => c.method === 'POST').map((c) => c.path);
      assert.deepEqual(order.slice(0, 3), ['/ncc/campaigns', '/ncc/shared-budgets', '/ncc/adgroups'], '캠페인 → 공유예산 → 그룹');
      assert.deepEqual(budgetPosts().map((c) => c.body), [{
        customerId: CUSTOMER, name: 'mq-cap', ownerType: 'CAMPAIGN', deliveryMethod: 'ACCELERATED', dailyBudget: 10000,
        campaignList: [{ nccCampaignId: id, customerId: CUSTOMER, name: `mq-${p.id}`, campaignTp: 'WEB_SITE' }],
      }]);
      const budget = S.sharedBudgets[0];
      assert.equal((await a.account()).sharedBudgetId, budget.sharedBudgetId);
      assert.deepEqual([naverCamp(id).sharedBudgetId, naverCamp(id).sharedDailyBudget, naverCamp(id).userLock], [budget.sharedBudgetId, 10000, true]);
      assert.equal(attachPuts().length, 0, '생성과 함께 붙었으니 붙이기 PUT 없음');
      const gets = S.calls.filter((c) => c.method === 'GET' && c.path === `/ncc/shared-budgets/${budget.sharedBudgetId}`);
      assert.equal(gets.length, 2, '저장 전 검증 + 붙인 뒤 재조회');
      const log = await ops(p.id, 'shared_budget');
      assert.deepEqual(log.map((l) => [l.method, l.path, l.status, l.naverId]), [['POST', '/ncc/shared-budgets', 'ok', budget.sharedBudgetId]]);
    });

    await t.test('second campaign attaches with the #962 minimal body and the stored amount; no second budget', async () => {
      S.sharedBudgets[0].dailyBudget = 6000; // 대장이 네이버에서 낮춘 금액 — 붙이기가 올리지 않는다
      const p = await approved();
      const r = await apply(p.id);
      assert.equal(r.body.data.status, 'applied', JSON.stringify(r.body));
      const id = await campOf(p.id);
      assert.equal(budgetPosts().length, 1, '공유예산은 하나뿐');
      const budget = S.sharedBudgets[0];
      assert.deepEqual(attachPuts().map((c) => [c.path, c.body]), [[`/ncc/campaigns/${id}`, {
        nccCampaignId: id, customerId: CUSTOMER, sharedBudgetId: budget.sharedBudgetId, sharedDailyBudget: 6000, sharedBudgetName: 'mq-cap',
      }]]);
      assert.deepEqual([naverCamp(id).sharedBudgetId, naverCamp(id).userLock], [budget.sharedBudgetId, true]);
      const log = await ops(p.id, 'shared_budget.attach');
      assert.deepEqual(log.map((l) => [l.method, l.status, l.naverId]), [['PUT', 'ok', id]]);
      S.sharedBudgets[0].dailyBudget = 10000;
    });

    await t.test('kill switch is checked right before the budget create and the attach', async () => {
      await resetAccount();
      S.hooks.after = (c, res) => { if (c.method === 'POST' && c.path === '/ncc/campaigns') process.env.ADS_EXECUTION_ENABLED = 'false'; return res; };
      const p = await approved();
      const r = await apply(p.id);
      resetFaults();
      process.env.ADS_EXECUTION_ENABLED = 'true';
      assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'ads_paused']);
      const before = budgetPosts().length;
      assert.equal(before, 1, '첫 테스트의 1건뿐 — 스위치가 꺼진 뒤 공유예산 POST 0');
      assert.equal(naverCamp(await campOf(p.id)).userLock, true);
      // 다시 켜고 재개 → 생성
      assert.equal((await apply(p.id)).body.data.status, 'applied');
      assert.equal(budgetPosts().length, 2);
      // 붙이기도 스위치를 본다
      const q = await approved();
      S.hooks.after = (c, res) => { if (c.method === 'POST' && c.path === '/ncc/campaigns') process.env.ADS_EXECUTION_ENABLED = 'false'; return res; };
      const n = attachPuts().length;
      const r2 = await apply(q.id);
      resetFaults();
      process.env.ADS_EXECUTION_ENABLED = 'true';
      assert.deepEqual([r2.body.data.status, r2.body.data.failCode, attachPuts().length], ['apply_failed', 'ads_paused', n]);
      assert.equal((await apply(q.id)).body.data.status, 'applied');
      assert.equal(attachPuts().length, n + 1);
    });

    await t.test('uncertain create is reconciled by name and never resent', async () => {
      await resetAccount();
      S.hooks.after = (c) => (c.method === 'POST' && c.path === '/ncc/shared-budgets' ? json(502, { code: 5000 }) : undefined); // 만들어졌지만 응답 유실
      const p = await approved();
      const n = budgetPosts().length;
      const r = await apply(p.id);
      resetFaults();
      assert.equal(r.body.data.status, 'applied', JSON.stringify(r.body));
      assert.equal(budgetPosts().length, n + 1, 'POST 1회');
      assert.equal((await a.account()).sharedBudgetId, S.sharedBudgets[0].sharedBudgetId, '이름으로 찾은 것을 저장');
      assert.deepEqual((await ops(p.id, 'shared_budget')).map((l) => l.status), ['uncertain']);
      // 안 만들어진 불확실(504): uncertain:shared_budget, 재적용도 다시 보내지 않는다
      await resetAccount();
      S.hooks.before = (c) => (c.method === 'POST' && c.path === '/ncc/shared-budgets' ? json(504, {}) : undefined);
      const q = await approved();
      const m = budgetPosts().length;
      const r1 = await apply(q.id);
      resetFaults();
      assert.deepEqual([r1.body.data.status, r1.body.data.failCode], ['apply_failed', 'uncertain:shared_budget']);
      const r2 = await apply(q.id);
      assert.deepEqual([r2.body.data.status, r2.body.data.failCode], ['apply_failed', 'uncertain:shared_budget']);
      assert.equal(budgetPosts().length, m + 1, '재적용은 이름 대조만');
      assert.equal((await a.account()).sharedBudgetId, null);
      const uncertain = await client.adAlert.findMany({ where: { type: 'ads.drift' } });
      assert.ok(uncertain.some((x) => x.payload.reason === 'uncertain' && x.payload.step === 'shared_budget'));
      assert.equal(naverCamp(await campOf(q.id)).userLock, true, '캠페인은 꺼진 채');
      // 해소 경로: 대장이 네이버 화면에서 그 캠페인으로 mq-cap을 만들면 이름 대조로 채택 → 불확실 행은 해소 표시
      S.sharedBudgets.push({ sharedBudgetId: 'sbg-owner-1', customerId: CUSTOMER, name: 'mq-cap', ownerType: 'CAMPAIGN', deliveryMethod: 'ACCELERATED', dailyBudget: 10000, status: 'ELIGIBLE', numberInUse: 0 });
      assert.equal((await apply(q.id)).body.data.status, 'applied');
      assert.deepEqual((await ops(q.id, 'shared_budget')).map((l) => [l.status, l.errorCode]), [['uncertain', 'reconciled:sbg-owner-1']]);
      assert.equal(budgetPosts().length, m + 1);
    });

    await t.test('account-level no-resend (round 1 I-1, probe P1): X uncertain while the list lags → Y never POSTs', async () => {
      await resetAccount();
      const lag = { on: true };
      S.hooks.after = (c) => {
        if (c.method === 'POST' && c.path === '/ncc/shared-budgets') return json(502, {}); // 만들어졌지만 응답 유실
        if (c.method === 'GET' && c.path === '/ncc/shared-budgets' && lag.on) return json(200, []); // 목록 반영 지연
        return undefined;
      };
      const x = await approved(), y = await approved();
      const n = budgetPosts().length;
      const rx = await apply(x.id);
      assert.deepEqual([rx.body.data.status, rx.body.data.failCode], ['apply_failed', 'uncertain:shared_budget']);
      const ry = await apply(y.id);
      assert.deepEqual([ry.body.data.status, ry.body.data.failCode], ['apply_failed', 'uncertain:shared_budget'], '다른 제안도 만들지 않는다');
      assert.equal(budgetPosts().length, n + 1, 'Y의 추가 POST 0');
      assert.equal(S.sharedBudgets.length, 1, 'mq-cap은 하나뿐');
      assert.ok((await client.adAlert.findMany({ where: { type: 'ads.drift' } })).some((al) => al.payload.reason === 'uncertain' && al.payload.proposalId === y.id));
      // 목록이 따라오면: Y는 그 예산을 채택해 붙이고, X는 이미 붙어 있다 — 둘 다 적용, POST는 여전히 1회
      lag.on = false;
      resetFaults();
      const before = attachPuts().length;
      assert.equal((await apply(y.id)).body.data.status, 'applied');
      assert.equal(attachPuts().length, before + 1, 'Y는 붙이기 PUT 경로');
      assert.equal((await apply(x.id)).body.data.status, 'applied');
      assert.deepEqual([budgetPosts().length, (await a.account()).sharedBudgetId], [n + 1, S.sharedBudgets[0].sharedBudgetId]);
    });

    await t.test('two mq-cap budgets: nothing chosen, nothing created, drift:shared_budget + alert', async () => {
      await resetAccount();
      const mq = { customerId: CUSTOMER, name: 'mq-cap', ownerType: 'CAMPAIGN', deliveryMethod: 'ACCELERATED', dailyBudget: 10000, status: 'ELIGIBLE', numberInUse: 1 };
      S.sharedBudgets.push({ ...mq, sharedBudgetId: 'sbg-dup-1' }, { ...mq, sharedBudgetId: 'sbg-dup-2' });
      const n = budgetPosts().length, m = attachPuts().length;
      const p = await approved();
      const r = await apply(p.id);
      assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'drift:shared_budget']);
      assert.deepEqual([budgetPosts().length, attachPuts().length, (await a.account()).sharedBudgetId], [n, m, null]);
      const id = await campOf(p.id);
      const al = await client.adAlert.findMany({ where: { type: 'ads.drift', dedupeKey: id } });
      assert.deepEqual([al[0]?.payload.field, al[0]?.payload.reason, al[0]?.payload.candidates], ['shared_budget', 'ambiguous', 2]);
    });

    await t.test('rejected create persists the Naver code; a definitive rejection may be retried', async () => {
      await resetAccount();
      S.hooks.before = (c) => (c.method === 'POST' && c.path === '/ncc/shared-budgets' ? json(400, { code: 1002, title: 'Invalid request' }) : undefined);
      const p = await approved();
      const r = await apply(p.id);
      resetFaults();
      assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'rejected:1002']);
      assert.deepEqual((await ops(p.id, 'shared_budget')).map((l) => [l.status, l.errorCode]), [['failed', 'ads_rejected:1002']]);
      assert.equal((await apply(p.id)).body.data.status, 'applied', '확정 거절은 다시 보낼 수 있다');
    });

    await t.test('uncertain attach is never resent', async () => {
      const n = attachPuts().length;
      S.hooks.before = (c) => (c.method === 'PUT' && c.query.fields === 'sharedBudget' ? json(504, {}) : undefined);
      const p = await approved();
      const r1 = await apply(p.id);
      resetFaults();
      assert.deepEqual([r1.body.data.status, r1.body.data.failCode], ['apply_failed', 'uncertain:shared_budget.attach']);
      const r2 = await apply(p.id);
      assert.deepEqual([r2.body.data.failCode, attachPuts().length], ['uncertain:shared_budget.attach', n + 1]);
      // 반영됐는데 응답만 유실(after 502)이면 재조회로 붙은 것을 확인하고 진행
      const q = await approved();
      S.hooks.after = (c) => (c.method === 'PUT' && c.query.fields === 'sharedBudget' ? json(502, {}) : undefined);
      const r3 = await apply(q.id);
      resetFaults();
      assert.equal(r3.body.data.status, 'applied', JSON.stringify(r3.body));
      assert.equal(attachPuts().length, n + 2);
      // 200인데 실제로 안 붙음 → 붙인 뒤 캠페인 재조회(verifyStored campaign)가 잡는다: drift + 알림, 다시 보내지 않음
      const w = await approved();
      S.hooks.after = (c, res) => { if (c.method === 'PUT' && c.query.fields === 'sharedBudget') Object.assign(naverCamp(c.body.nccCampaignId), { sharedBudgetId: null, sharedDailyBudget: null }); return res; };
      const r4 = await apply(w.id);
      resetFaults();
      assert.deepEqual([r4.body.data.status, r4.body.data.failCode], ['apply_failed', 'drift:sharedBudgetId']);
      const id = await campOf(w.id);
      assert.ok((await client.adAlert.findMany({ where: { type: 'ads.drift', dedupeKey: id } })).some((x) => x.payload.field === 'sharedBudgetId'));
      const r5 = await apply(w.id);
      assert.deepEqual([r5.body.data.failCode, attachPuts().length], ['drift:sharedBudgetId', n + 3], '원장 ok면 다시 보내지 않고 드리프트로 판정');
    });

    await t.test('unsafe existing mq-cap: not stored, not attached, campaign paused, drift alert', async () => {
      await resetAccount();
      S.sharedBudgets.push({ sharedBudgetId: 'sbg-unsafe-1', customerId: CUSTOMER, name: 'mq-cap', ownerType: 'CAMPAIGN', dailyBudget: 50000, status: 'ELIGIBLE', numberInUse: 1 });
      const n = budgetPosts().length, m = attachPuts().length;
      const p = await approved();
      const r = await apply(p.id);
      assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'drift:shared_budget']);
      assert.deepEqual([budgetPosts().length, attachPuts().length, (await a.account()).sharedBudgetId], [n, m, null]);
      const id = await campOf(p.id);
      assert.equal(naverCamp(id).userLock, true);
      const al = await client.adAlert.findMany({ where: { type: 'ads.drift', dedupeKey: id } });
      assert.deepEqual([al[0]?.payload.field, al[0]?.payload.reason, al[0]?.payload.sharedBudgetId], ['shared_budget', 'dailyBudget', 'sbg-unsafe-1']);
      assert.deepEqual((await ops(p.id, 'pause:shared_budget')).map((l) => [l.method, l.path, l.status]), [['PUT', `/ncc/campaigns/${id}`, 'ok']], '드리프트면 캠페인을 끈다(끄기 원장)');
      // 공유예산 판정 순간 캠페인이 켜져 있고 끄기가 확인되지 않으면(PUT 200인데 그대로 켜짐) pause_failed + ads.pause_failed, 미러는 사실대로 켜짐
      S.hooks.after = (c, res) => {
        if (c.method === 'GET' && c.path === '/ncc/shared-budgets') { const last = S.campaigns.at(-1); last.userLock = false; S.ignorePause.add(last.nccCampaignId); }
        return res;
      };
      const w = await approved();
      const r3 = await apply(w.id);
      resetFaults();
      const wid = await campOf(w.id);
      assert.deepEqual([r3.body.data.status, r3.body.data.failCode], ['apply_failed', 'pause_failed:shared_budget']);
      assert.equal((await client.adCampaign.findFirstOrThrow({ where: { naverId: wid } })).userLock, false, '켜진 사실 그대로(다음 적용이 먼저 끈다)');
      assert.equal((await client.adAlert.findMany({ where: { type: 'ads.pause_failed', dedupeKey: wid } })).length, 1);
      naverCamp(wid).userLock = true;
      // 붙인 뒤 공유예산이 어긋나도 같은 경로(드리프트 → 끄기 → 알림)
      S.sharedBudgets[0].dailyBudget = 10000;
      S.hooks.after = (c, res) => { if (c.method === 'PUT' && c.query.fields === 'sharedBudget') S.sharedBudgets[0].dailyBudget = 20000; return res; };
      const q = await approved();
      const r2 = await apply(q.id);
      resetFaults();
      assert.deepEqual([r2.body.data.status, r2.body.data.failCode], ['apply_failed', 'drift:sharedBudget.dailyBudget']);
      S.sharedBudgets[0].dailyBudget = 10000;
    });

    await t.test('the account id is stored only if still null; a different id stops the apply', async () => {
      await resetAccount();
      S.hooks.after = async (c, res) => {
        if (c.method === 'POST' && c.path === '/ncc/shared-budgets') await client.adAccount.update({ where: { id: a.accountId }, data: { sharedBudgetId: 'sbg-raced-1' } });
        return res;
      };
      const p = await approved();
      const r = await apply(p.id);
      resetFaults();
      assert.deepEqual([r.body.data.status, r.body.data.failCode], ['apply_failed', 'ambiguous:shared_budget']);
      assert.equal((await a.account()).sharedBudgetId, 'sbg-raced-1', '덮어쓰지 않는다');
    });

    await t.test('without a shared budget only one new_campaign apply runs per account', async () => {
      await resetAccount();
      const busy = await approved();
      await client.adProposal.update({ where: { id: busy.id }, data: { status: 'applying', updatedAt: new Date() } });
      const p = await approved();
      const n = S.calls.filter((c) => c.method !== 'GET').length;
      const r = await apply(p.id);
      assert.deepEqual([r.status, r.body.error.code], [409, 'apply_in_progress']);
      assert.equal(S.calls.filter((c) => c.method !== 'GET').length, n, '쓰기 0');
      assert.equal((await proposalRow(p.id)).status, 'approved', '점유하지 않음');
      // 죽은(10분 지난) 적용은 막지 않는다
      await client.adProposal.update({ where: { id: busy.id }, data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
      const stale = await apply(p.id);
      assert.equal(stale.body.data?.status, 'applied', JSON.stringify(stale.body));
      // 공유예산이 생긴 뒤에는 동시에 적용해도 된다(붙이기만 함)
      await client.adProposal.update({ where: { id: busy.id }, data: { status: 'applying', updatedAt: new Date() } });
      const q = await approved();
      assert.equal((await apply(q.id)).body.data.status, 'applied');
    });
  } finally {
    delete process.env.ADS_EXECUTION_ENABLED;
    await env.close();
  }
});
