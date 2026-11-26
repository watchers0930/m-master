/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process */
// 확장소재(3.6단계, lib/ads/extensions) — 실DB(PGlite) + 가짜 네이버·광고 사이트·가짜 LLM.
// - 등록: 린트 위반·다른 사이트·열리지 않는 주소는 422(네이버 쓰기 0). 통과하면 유형마다 POST 1회 → 미러 created·원장·감사 로그.
// - 다시 등록: 살아 있으면 exists(POST 0), 네이버에서 지워졌으면 새로 만든다. 그룹에 같은 유형이 2개면 limit.
// - 불확실: 반영된 불확실은 목록 대조로 채택, 반영 안 된 불확실은 재전송 없이 409 extension_uncertain(행 creating) → 바로 다시 = 409 진행 중,
//   10분 지난 뒤에도 원장에 보낸 흔적이 있으면 재전송하지 않는다. 확정 거절은 rejected·행 삭제.
// - 비상 정지 = 503 + 네이버 0, 남의 그룹 = 404. 초안: 사이트맵 같은 호스트만·지어낸 주소 제거·교정 1회·비용 원장.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('./fixtures/ads-db.cjs');
const { setupApplyEnv } = require('./fixtures/apply-env.cjs');
const { json } = require('./fixtures/fake-naver.cjs');
const packageDir = process.env.PGLITE_SOCKET_PACKAGE;

const SITE = 'https://vestra.ai.kr';
const LINKS = [{ name: '권리분석', url: `${SITE}/renewal/rights` }, { name: '전세 안전', url: `${SITE}/renewal/jeonse` }, { name: '요금 안내', url: `${SITE}/pricing` }];
const BODY = { headline: 'AI 등기부 분석', promo: '계약 전 무료 점검', subLinks: LINKS };

test('ad extensions on a real database', { skip: !packageDir && 'Set PGLITE_SOCKET_PACKAGE' }, async (t) => {
  const a = await setupApplyEnv(packageDir);
  const { env, naver, approved, apply, answers, llmCalls, costRows } = a;
  const { client } = env;
  const route = require('../../../app/api/ads/groups/[id]/extensions/route.ts');
  const draftRoute = require('../../../app/api/ads/groups/[id]/extensions/draft/route.ts');
  const ctx = (id) => ({ params: Promise.resolve({ id }) });
  const post = (id, body) => a.call(() => route.POST(request('POST', `/api/ads/groups/${id}/extensions`, body), ctx(id)));
  const get = (id) => a.call(() => route.GET(request('GET', `/api/ads/groups/${id}/extensions`), ctx(id)));
  const release = (id, type) => a.call(() => route.DELETE(request('DELETE', `/api/ads/groups/${id}/extensions?type=${type}`), ctx(id)));
  const draft = (id) => a.call(() => draftRoute.POST(request('POST', `/api/ads/groups/${id}/extensions/draft`), ctx(id)));
  const extPosts = () => naver.state.calls.filter((c) => c.method === 'POST' && c.path === '/ncc/ad-extensions').length;
  for (const l of LINKS) naver.state.site.set(l.url, { status: 200, body: `<title>${l.name}</title>` });
  try {
    const p = await approved();
    assert.equal((await apply(p.id)).body.data.status, 'applied');
    const groups = await client.adGroup.findMany({ where: { proposalId: p.id }, orderBy: { name: 'asc' } });
    const [g1, g2] = groups;

    await t.test('lint and link problems are 422 with zero Naver writes', async () => {
      const before = extPosts();
      const long = await post(g1.id, { promo: '등기부를 올리면 근저당 압류를 바로 분석' });
      assert.deepEqual([long.status, long.body.error.code], [422, 'extension_invalid']);
      assert.ok(long.body.error.message.includes('14자'), long.body.error.message);
      const dot = await post(g1.id, { promo: '근저당·압류 점검' });
      assert.ok(dot.body.error.message.includes('·'), dot.body.error.message);
      const other = await post(g1.id, { subLinks: [...LINKS.slice(0, 2), { name: '다른곳', url: 'https://evil.example/x' }] });
      assert.deepEqual([other.status, other.body.error.code], [422, 'extension_invalid']);
      const two = await post(g1.id, { subLinks: LINKS.slice(0, 2) });
      assert.ok(two.body.error.message.includes('3~4개'), two.body.error.message);
      const dead = await post(g1.id, { subLinks: [...LINKS.slice(0, 2), { name: '없는곳', url: `${SITE}/nope` }] });
      assert.deepEqual([dead.status, dead.body.error.code], [422, 'sub_link_unreachable']);
      naver.state.site.set(`${SITE}/moved`, { status: 301, location: 'https://evil.example/landing' });
      const moved = await post(g1.id, { subLinks: [...LINKS.slice(0, 2), { name: '이동', url: `${SITE}/moved` }] });
      assert.equal(moved.body.error.code, 'sub_link_unreachable', '다른 호스트로 리다이렉트 = 죽은 링크');
      assert.ok(!naver.state.calls.some((c) => c.site === 'evil.example'), '다른 호스트는 부르지 않는다');
      const empty = await post(g1.id, { headline: '  ', subLinks: [] });
      assert.equal(empty.status, 400);
      assert.equal(extPosts(), before);
      assert.equal(await client.adExtension.count(), 0);
    });

    await t.test('register creates each type once; mirror, ledger, audit; again = exists with no POST', async () => {
      const r = await post(g1.id, BODY);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.data.outcomes.map((o) => [o.type, o.result]), [['HEADLINE', 'created'], ['DESCRIPTION', 'created'], ['SUB_LINKS', 'created']]);
      const made = naver.state.extensions.filter((e) => e.ownerId === g1.naverId);
      assert.deepEqual(made.map((e) => e.type), ['HEADLINE', 'DESCRIPTION', 'SUB_LINKS']);
      const sub = made[2];
      assert.deepEqual(sub.adExtension, LINKS.map((l) => ({ name: l.name, final: l.url })));
      assert.ok(made.every((e) => e.pcChannelId === e.mobileChannelId && e.pcChannelId.startsWith('bsn-')));
      const rows = await client.adExtension.findMany({ where: { parentNaverId: g1.naverId }, orderBy: { type: 'asc' } });
      assert.deepEqual(rows.map((x) => [x.type, x.status, x.inspectStatus, x.ownerId]), [['DESCRIPTION', 'created', 'UNDER_REVIEW', 'owner'], ['HEADLINE', 'created', 'UNDER_REVIEW', 'owner'], ['SUB_LINKS', 'created', 'UNDER_REVIEW', 'owner']]);
      const logs = await client.adOperationLog.findMany({ where: { path: '/ncc/ad-extensions' } });
      assert.ok(logs.length === 3 && logs.every((l) => l.status === 'ok' && l.step.startsWith(`ext:${g1.naverId}:`)));
      assert.equal((await a.audits('ads.extension_create')).length, 1);
      const before = extPosts();
      const again = await post(g1.id, BODY);
      assert.deepEqual(again.body.data.outcomes.map((o) => o.result), ['exists', 'exists', 'exists']);
      assert.equal(extPosts(), before);
      const list = await get(g1.id);
      assert.deepEqual(list.body.data.extensions.map((e) => [e.type, e.mine]), [['HEADLINE', true], ['DESCRIPTION', true], ['SUB_LINKS', true]]);
      assert.equal(list.body.data.extensions[2].summary, '서브링크: 권리분석 · 전세 안전 · 요금 안내');
    });

    await t.test('deleted in Naver → recreated; two of a type already in Naver → limit', async () => {
      naver.state.extensions.find((e) => e.ownerId === g1.naverId && e.type === 'HEADLINE').delFlag = true;
      const r = await post(g1.id, { headline: '등기부 위험 확인' });
      assert.deepEqual(r.body.data.outcomes.map((o) => o.result), ['created']);
      const row = await client.adExtension.findFirst({ where: { parentNaverId: g1.naverId, type: 'HEADLINE' } });
      assert.deepEqual(row.content, { headline: '등기부 위험 확인' });
      for (const n of [1, 2]) naver.state.extensions.push({ nccAdExtensionId: `ext-manual-${n}`, ownerId: g2.naverId, type: 'DESCRIPTION', userLock: false, status: 'ELIGIBLE', adExtension: { description: `직접${n}` } });
      const limit = await post(g2.id, { promo: '계약 전 무료 점검' });
      assert.deepEqual(limit.body.data.outcomes.map((o) => o.result), ['limit']);
      assert.equal(await client.adExtension.count({ where: { parentNaverId: g2.naverId } }), 0);
      const list = await get(g2.id);
      assert.deepEqual(list.body.data.extensions.map((e) => e.mine), [false, false], '대장이 직접 만든 것도 보인다');
    });

    await t.test('uncertain POST: applied → adopted by content; not applied → no resend, in-progress, still no resend after 10 minutes', async () => {
      naver.state.hooks.after = async (call) => (call.method === 'POST' && call.path === '/ncc/ad-extensions' ? json(500, { code: 9999 }) : undefined);
      const adopted = await post(g2.id, { headline: '전세 보증금 점검' });
      assert.deepEqual(adopted.body.data.outcomes.map((o) => o.result), ['created'], JSON.stringify(adopted.body));
      naver.state.hooks = {};
      naver.state.hooks.before = async (call) => (call.method === 'POST' && call.path === '/ncc/ad-extensions' ? json(503, { code: 9999 }) : undefined);
      const before = extPosts();
      const lost = await post(g2.id, { subLinks: LINKS });
      assert.deepEqual([lost.status, lost.body.error.code], [409, 'extension_uncertain']);
      naver.state.hooks = {};
      const row = await client.adExtension.findFirst({ where: { parentNaverId: g2.naverId, type: 'SUB_LINKS' } });
      assert.equal(row.status, 'creating');
      const busy = await post(g2.id, { subLinks: LINKS });
      assert.deepEqual([busy.status, busy.body.error.code], [409, 'extension_in_progress']);
      await client.adExtension.update({ where: { id: row.id }, data: { claimedAt: new Date(Date.now() - 11 * 60_000) } });
      const stale = await post(g2.id, { subLinks: LINKS });
      assert.deepEqual([stale.status, stale.body.error.code], [409, 'extension_uncertain'], '원장에 보낸 흔적 → 재전송 금지');
      assert.equal(extPosts(), before + 1, 'POST는 처음 1번뿐');
      // 막힌 등록: 회수 시도가 점유 시각을 새로 잡았으므로(재시도마다 10분 다시) 다시 10분 지난 뒤 화면에 stale로 보이고,
      // 대장이 '다시 확인' → 네이버에 없으면 점유를 풀고 다음 등록은 새 단계로 1번 보낸다
      assert.deepEqual((await get(g2.id)).body.data.pending, [{ type: 'SUB_LINKS', stale: false }]);
      await client.adExtension.update({ where: { id: row.id }, data: { claimedAt: new Date(Date.now() - 11 * 60_000) } });
      const shown = await get(g2.id);
      assert.deepEqual(shown.body.data.pending, [{ type: 'SUB_LINKS', stale: true }]);
      assert.equal((await release(g2.id, 'BOGUS')).status, 404);
      const freed = await release(g2.id, 'SUB_LINKS');
      assert.deepEqual([freed.status, freed.body.data.result], [200, 'released']);
      assert.equal((await release(g2.id, 'SUB_LINKS')).status, 404, '풀 것이 없으면 404');
      const retry = await post(g2.id, { subLinks: LINKS });
      assert.deepEqual(retry.body.data.outcomes.map((o) => o.result), ['created']);
      assert.equal(extPosts(), before + 2);
      // 반영된 채 멈춘 경우: 풀기가 목록에서 같은 내용을 찾아 채택한다(재전송 없음)
      naver.state.hooks.after = async (call) => (call.method === 'POST' && call.path === '/ncc/ad-extensions' ? json(500, {}) : undefined);
      naver.state.extensions = naver.state.extensions.filter((e) => !(e.ownerId === g1.naverId && e.type === 'DESCRIPTION'));
      await client.adExtension.deleteMany({ where: { parentNaverId: g1.naverId, type: 'DESCRIPTION' } });
      let n = 0;
      naver.state.hooks.before = async (call) => {
        if (call.method === 'GET' && call.path === '/ncc/ad-extensions' && call.query.ownerId === g1.naverId && ++n === 2) return json(200, []); // 불확실 대조 목록만 비게
        return undefined;
      };
      const half = await post(g1.id, { promo: '무료 점검' });
      naver.state.hooks = {};
      assert.equal(half.body.error.code, 'extension_uncertain');
      const fresh = await release(g1.id, 'DESCRIPTION');
      assert.equal(fresh.body.error.code, 'extension_in_progress', '10분 안에는 풀지 않는다');
      await client.adExtension.updateMany({ where: { parentNaverId: g1.naverId, type: 'DESCRIPTION' }, data: { claimedAt: new Date(Date.now() - 11 * 60_000) } });
      const adoptedLater = await release(g1.id, 'DESCRIPTION');
      assert.equal(adoptedLater.body.data.result, 'adopted');
      const row2 = await client.adExtension.findFirst({ where: { parentNaverId: g1.naverId, type: 'DESCRIPTION' } });
      assert.equal(row2.status, 'created');
      assert.equal(naver.state.extensions.filter((e) => e.ownerId === g1.naverId && e.type === 'DESCRIPTION').length, 1, '중복 없음');
      assert.deepEqual((await a.audits('ads.extension_release')).map((x) => x.payload.result).sort(), ['adopted', 'released'], '채택도 감사 로그');
      // codex 2차: 원장 ok(naverId)·미러 creating인데 네이버에서 문구를 고침 → 풀기는 내용이 달라도 원장 id로 채택(재생성 없음)
      const edited = { nccAdExtensionId: 'ext-edited', ownerId: g2.naverId, type: 'HEADLINE', userLock: false, status: 'PAUSED', delFlag: false, adExtension: { headline: '네이버에서 고친 제목' } };
      await client.adExtension.deleteMany({ where: { parentNaverId: g2.naverId, type: 'HEADLINE' } });
      naver.state.extensions = naver.state.extensions.filter((e) => !(e.ownerId === g2.naverId && e.type === 'HEADLINE'));
      naver.state.extensions.push(edited);
      const c2 = await client.adExtension.create({ data: { ownerId: 'owner', adAccountId: a.accountId, parentNaverId: g2.naverId, type: 'HEADLINE', content: { headline: '원래 제목' }, claimedAt: new Date(Date.now() - 11 * 60_000) } });
      await client.adOperationLog.create({ data: { ownerId: 'owner', adAccountId: a.accountId, step: `ext:${g2.naverId}:HEADLINE#${c2.id}`, method: 'POST', path: '/ncc/ad-extensions', requestHash: 'x', status: 'ok', naverId: 'ext-edited' } });
      const byLog = await release(g2.id, 'HEADLINE');
      assert.equal(byLog.body.data.result, 'adopted');
      assert.equal((await client.adExtension.findUnique({ where: { id: c2.id } })).naverId, 'ext-edited');
    });

    await t.test('codex HIGH: a created row missing from a stale list is re-read before deletion (no duplicate); MED: stale claim matched by its own content', async () => {
      // 다른 실행이 방금 만든 추가제목: 이번 요청의 시작 목록에는 없다(낡은 목록) → 단건 재조회로 살아 있음 확인 → exists, POST 0
      const h = naver.state.extensions.find((e) => e.ownerId === g1.naverId && e.type === 'HEADLINE' && !e.delFlag);
      let first = true;
      naver.state.hooks.before = async (call) => {
        if (call.method === 'GET' && call.path === '/ncc/ad-extensions' && first) { first = false; return json(200, []); }
        return undefined;
      };
      const before = extPosts();
      const r = await post(g1.id, { headline: '다른 문구' });
      naver.state.hooks = {};
      assert.deepEqual(r.body.data.outcomes.map((o) => [o.result, o.naverId]), [['exists', h.nccAdExtensionId]]);
      assert.equal(extPosts(), before, '중복 생성 없음');
      assert.ok(await client.adExtension.findFirst({ where: { naverId: h.nccAdExtensionId } }), '미러 유지');
      // 문구 A가 네이버에 만들어진 뒤 실행이 죽음(행 creating·원장 sent) → 10분 뒤 문구 B로 다시 → A를 찾아 exists(B는 보내지 않음)
      const g3 = groups[1];
      const created = { nccAdExtensionId: 'ext-dead-run', ownerId: g3.naverId, type: 'DESCRIPTION', userLock: false, status: 'PAUSED', delFlag: false, adExtension: { description: '문구 A' } };
      await client.adExtension.deleteMany({ where: { parentNaverId: g3.naverId, type: 'DESCRIPTION' } });
      naver.state.extensions = naver.state.extensions.filter((e) => !(e.ownerId === g3.naverId && e.type === 'DESCRIPTION'));
      naver.state.extensions.push(created);
      const claim = await client.adExtension.create({ data: { ownerId: 'owner', adAccountId: a.accountId, parentNaverId: g3.naverId, type: 'DESCRIPTION', content: { description: '문구 A' }, claimedAt: new Date(Date.now() - 11 * 60_000) } });
      await client.adOperationLog.create({ data: { ownerId: 'owner', adAccountId: a.accountId, step: `ext:${g3.naverId}:DESCRIPTION#${claim.id}`, method: 'POST', path: '/ncc/ad-extensions', requestHash: 'x', status: 'sent' } });
      const b = await post(g3.id, { promo: '문구 B' });
      assert.deepEqual(b.body.data.outcomes.map((o) => [o.result, o.naverId]), [['exists', 'ext-dead-run']], JSON.stringify(b.body));
      assert.equal(extPosts(), before);
      assert.equal((await client.adExtension.findUnique({ where: { id: claim.id } })).status, 'created');
    });

    await t.test('definitive rejection → rejected outcome and claim removed', async () => {
      naver.state.hooks.before = async (call) => (call.method === 'POST' && call.path === '/ncc/ad-extensions' ? json(400, { code: 4001, title: 'rejected' }) : undefined);
      const r = await post(g2.id, { headline: '보증금 지키기' });
      naver.state.hooks = {};
      assert.deepEqual(r.body.data.outcomes.map((o) => [o.result, o.naverCode]), [['exists', undefined]], '이미 만든 추가제목은 그대로');
      await client.adExtension.deleteMany({ where: { parentNaverId: g2.naverId, type: 'HEADLINE' } });
      naver.state.extensions = naver.state.extensions.filter((e) => !(e.ownerId === g2.naverId && e.type === 'HEADLINE'));
      naver.state.hooks.before = async (call) => (call.method === 'POST' && call.path === '/ncc/ad-extensions' ? json(400, { code: 4001, title: 'rejected' }) : undefined);
      const rejected = await post(g2.id, { headline: '보증금 지키기' });
      naver.state.hooks = {};
      assert.deepEqual(rejected.body.data.outcomes.map((o) => [o.result, o.naverCode]), [['rejected', 4001]]);
      assert.equal(await client.adExtension.count({ where: { parentNaverId: g2.naverId, type: 'HEADLINE' } }), 0);
    });

    await t.test('switch off = 503 with zero Naver calls; another owner gets 404', async () => {
      process.env.ADS_EXECUTION_ENABLED = 'false';
      const before = naver.state.calls.length;
      const off = await post(g1.id, { headline: '새 제목' });
      process.env.ADS_EXECUTION_ENABLED = 'true';
      assert.deepEqual([off.status, off.body.error.code], [503, 'ads_paused']);
      assert.equal(naver.state.calls.length, before);
      env.session.user = 'other';
      try {
        assert.equal((await post(g1.id, BODY)).status, 404);
        assert.equal((await get(g1.id)).status, 404);
        assert.equal((await draft(g1.id)).status, 404);
      } finally {
        env.session.user = 'owner';
      }
    });

    await t.test('draft: same-host sitemap pages only, invented URL dropped, one repair, cost recorded, nothing stored', async () => {
      naver.state.site.set(`${SITE}/sitemap.xml`, { status: 200, body: `<urlset>${[...LINKS.map((l) => l.url), 'https://evil.example/a', `${SITE}/sitemap-posts.xml`, `${SITE}/faq`].map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>` });
      naver.state.site.set(`${SITE}/faq`, { status: 200, body: '<title>자주 묻는 질문</title>' });
      const costBefore = (await costRows()).length;
      const extBefore = await client.adExtension.count();
      llmCalls.length = 0;
      answers.push({ headline: '업계 최고 등기부 분석기', promo: '무료 점검', subLinks: [...LINKS, { name: '가짜', url: `${SITE}/invented` }] });
      answers.push({ headline: 'AI 등기부 분석', promo: '무료 점검', subLinks: [...LINKS, { name: '가짜', url: `${SITE}/invented` }] });
      const r = await draft(g1.id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const d = r.body.data;
      assert.deepEqual(d.pages.map((x) => x.url), [...LINKS.map((l) => l.url), `${SITE}/faq`], '다른 호스트·하위 사이트맵(.xml) 제외');
      assert.equal(d.pages[3].title, '자주 묻는 질문');
      assert.deepEqual(d.draft.subLinks.map((l) => l.url), LINKS.map((l) => l.url), '목록에 없는 주소는 버린다');
      assert.equal(d.draft.headline, 'AI 등기부 분석');
      assert.deepEqual(d.issues, []);
      assert.equal(llmCalls.length, 2, '최상급 표현 → 교정 1회');
      const user = JSON.parse(llmCalls[0].messages[1].content);
      assert.ok(Array.isArray(user.untrustedData.pages) && user.untrustedData.keywords.length > 0);
      assert.equal((await costRows()).length, costBefore + 2);
      assert.equal(await client.adExtension.count(), extBefore, '초안은 저장하지 않는다');
    });
  } finally {
    await env.close();
  }
});
