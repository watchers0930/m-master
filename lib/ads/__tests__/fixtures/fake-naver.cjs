/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test helper. */
/* global require, module, Response, URL */
// 가짜 네이버 검색광고 API(메모리 상태). 실제 네트워크·실제 키를 쓰지 않는다.
// - 인증: X-Customer·X-API-KEY가 등록된 키와 같고, X-Signature가 등록된 비밀키로 만든 서명과 같아야 한다(아니면 401).
// - 상태: 캠페인·공유예산·비즈채널. 호출 기록(calls)으로 순서·횟수·본문을 검증한다.
// - 장애 주입: hooks.before(call) → Response를 돌려주면 그 응답으로 대체(상태 변경 없음), hooks.after(call, res) → 응답 교체(상태는 이미 반영).
const { createHmac } = require('node:crypto');

const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sign = (ts, method, path, secret) => createHmac('sha256', secret).update(`${ts}.${method}.${path}`).digest('base64');

function fakeNaver() {
  const state = {
    keys: new Map(), // customerId → { apiKey, secretKey }
    campaigns: [], sharedBudgets: [], channels: [],
    calls: [], hooks: {}, seq: 0,
    ignorePause: new Set(), // 이 캠페인은 PUT이 200이어도 실제로 꺼지지 않는다(재조회 검증용)
    pageCap: undefined, ignoreCursor: false,
    keywordRows: [], // GET /keywordstool 응답 행(RelKwdStat). 힌트와 무관하게 전부 돌려준다
  };
  // 명세 페이지: recordSize개, baseSearchId(+selector=NEXT)면 그 id 다음부터. pageCap = 서버 자체 상한(요청 크기 무시하고 자름),
  // ignoreCursor = baseSearchId를 무시하고 늘 첫 페이지(커서 미지원 서버 시뮬레이션)
  const campaignPage = (query) => {
    let start = 0;
    if (query.baseSearchId && !state.ignoreCursor) {
      const i = state.campaigns.findIndex((c) => c.nccCampaignId === query.baseSearchId);
      start = i < 0 ? state.campaigns.length : i + 1;
    }
    const size = Math.min(Number(query.recordSize) || state.campaigns.length, state.pageCap ?? Infinity);
    return state.campaigns.slice(start, start + size);
  };
  const handle = (call) => {
    const { method, path, query, body } = call;
    let m;
    if (method === 'GET' && path === '/ncc/campaigns') return json(200, campaignPage(query).map((c) => ({ ...c })));
    if (method === 'PUT' && (m = path.match(/^\/ncc\/campaigns\/([^/]+)$/))) {
      const c = state.campaigns.find((x) => x.nccCampaignId === m[1]);
      if (!c) return json(404, { code: 1002, title: 'not found' });
      if (query.fields === 'userLock' && !state.ignorePause.has(c.nccCampaignId)) c.userLock = body.userLock;
      return json(200, { ...c });
    }
    if (method === 'GET' && path === '/ncc/shared-budgets') return json(200, state.sharedBudgets.map((b) => ({ ...b })));
    if (method === 'GET' && (m = path.match(/^\/ncc\/shared-budgets\/([^/]+)$/))) {
      const b = state.sharedBudgets.find((x) => x.sharedBudgetId === m[1]);
      return b ? json(200, { ...b }) : json(404, { code: 1002, title: 'not found' });
    }
    if (method === 'POST' && path === '/ncc/shared-budgets') {
      const b = { ...body, sharedBudgetId: `sbg-a001-00-${String(++state.seq).padStart(6, '0')}`, status: 'ELIGIBLE', numberInUse: 0 };
      state.sharedBudgets.push(b);
      return json(200, { ...b });
    }
    if (method === 'GET' && path === '/ncc/channels') return json(200, state.channels.filter((c) => !query.channelTp || c.channelTp === query.channelTp).map((c) => ({ ...c })));
    if (method === 'GET' && (m = path.match(/^\/ncc\/channels\/([^/]+)$/))) {
      const c = state.channels.find((x) => x.nccBusinessChannelId === m[1]);
      return c ? json(200, { ...c }) : json(404, { code: 1002, title: 'not found' });
    }
    if (method === 'GET' && path === '/keywordstool') return json(200, { keywordList: state.keywordRows.map((r) => ({ ...r })) });
    return json(404, { code: 1002, title: 'no route' });
  };
  const fn = async (url, init) => {
    const u = new URL(url);
    const h = init.headers;
    const call = { method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined, headers: { ...h } };
    state.calls.push(call);
    if (state.hooks.before) { const r = await state.hooks.before(call); if (r) return r; }
    const cred = state.keys.get(h['X-Customer']);
    if (!cred || cred.apiKey !== h['X-API-KEY'] || sign(h['X-Timestamp'], init.method, u.pathname, cred.secretKey) !== h['X-Signature'])
      return json(401, { code: 1001, title: 'Unauthorized' });
    const res = handle(call);
    return state.hooks.after ? (await state.hooks.after(call, res)) ?? res : res;
  };
  const count = (method, re) => state.calls.filter((c) => c.method === method && re.test(c.path)).length;
  return { fn, state, count, json };
}

module.exports = { fakeNaver, json };
