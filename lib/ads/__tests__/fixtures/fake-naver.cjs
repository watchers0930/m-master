/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test helper. */
/* global require, module, Response, URL */
// 가짜 네이버 검색광고 API(메모리 상태). 실제 네트워크·실제 키를 쓰지 않는다.
// - 인증: X-Customer·X-API-KEY가 등록된 키와 같고, X-Signature가 등록된 비밀키로 만든 서명과 같아야 한다(아니면 401).
// - 상태: 캠페인·공유예산·비즈채널. 호출 기록(calls)으로 순서·횟수·본문을 검증한다.
// - 장애 주입: hooks.before(call) → Response를 돌려주면 그 응답으로 대체(상태 변경 없음), hooks.after(call, res) → 응답 교체(상태는 이미 반영).
// - 적용(Task 9): 캠페인·광고그룹·키워드·소재 생성/조회/켜기·끄기, /stats(spend: id → salesAmt, 상태에 있는 캠페인은 0원 행, statsOmitIdle이면 spend에 없는 id는 빠짐).
//   createOverrides[kind] = 저장 시 덮어쓸 필드(네이버가 다른 값을 저장한 상황), ignoreAdLock = 소재 생성 시 userLock을 무시(false로 저장).
// - 감시·동기화(Task 11): dailyStats(KST 날짜 → id → 성과 행, 있으면 그 날 /stats는 이 표를 쓴다), bizmoney(GET /billing/bizmoney 본문),
//   GET /ncc/keywords·/ncc/ads ?ids=쉼표목록. 끄기 무시(ignorePause)는 모든 종류에서 PUT 응답을 '꺼짐'으로 거짓 보고한다(재조회만 사실).
const { createHmac } = require('node:crypto');

const json = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sign = (ts, method, path, secret) => createHmac('sha256', secret).update(`${ts}.${method}.${path}`).digest('base64');

function fakeNaver() {
  const state = {
    keys: new Map(), // customerId → { apiKey, secretKey }
    campaigns: [], sharedBudgets: [], channels: [],
    calls: [], hooks: {}, seq: 0,
    ignorePause: new Set(), // 이 id는 끄기 PUT(userLock=true)이 200이어도 실제로 꺼지지 않는다(재조회 검증용). 켜기는 반영
    ignorePauseKinds: new Set(), // 'campaigns'|'adgroups'|'keywords'|'ads' — 그 종류 전부 끄기 PUT 무시
    pageCap: undefined, ignoreCursor: false,
    keywordRows: [], // GET /keywordstool 응답 행(RelKwdStat). 힌트와 무관하게 전부 돌려준다
    adgroups: [], keywords: [], ads: [], spend: new Map(), createOverrides: {}, ignoreAdLock: false,
    dailyStats: new Map(), bizmoney: { bizmoney: 10000000, budgetLock: false, refundLock: false },
  };
  const nextId = (prefix) => `${prefix}-a001-01-${String(++state.seq).padStart(9, '0')}`;
  const page = (list, query, idField) => {
    let start = 0;
    if (query.baseSearchId && !state.ignoreCursor) {
      const i = list.findIndex((x) => x[idField] === query.baseSearchId);
      start = i < 0 ? list.length : i + 1;
    }
    return list.slice(start, start + Math.min(Number(query.recordSize) || list.length, state.pageCap ?? Infinity));
  };
  const ENTITY = {
    campaigns: { list: () => state.campaigns, id: 'nccCampaignId' },
    adgroups: { list: () => state.adgroups, id: 'nccAdgroupId' },
    keywords: { list: () => state.keywords, id: 'nccKeywordId' },
    ads: { list: () => state.ads, id: 'nccAdId' },
  };
  const budgetOf = (id) => state.sharedBudgets.find((b) => b.sharedBudgetId === id);
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
    // 캠페인에 _customer가 있으면 그 고객(X-Customer)에게만 보인다(여러 계정 감시 테스트용). 없으면 모두에게 보인다.
    const visible = (c) => !c._customer || c._customer === call.headers['X-Customer'];
    if (method === 'GET' && path === '/ncc/campaigns') return json(200, campaignPage(query).filter(visible).map((c) => ({ ...c })));
    if (method === 'PUT' && (m = path.match(/^\/ncc\/campaigns\/([^/]+)$/))) {
      const c = state.campaigns.find((x) => x.nccCampaignId === m[1]);
      if (!c) return json(404, { code: 1002, title: 'not found' });
      const ignored = body.userLock === true && (state.ignorePause.has(c.nccCampaignId) || state.ignorePauseKinds.has('campaigns'));
      if (query.fields === 'userLock' && !ignored) c.userLock = body.userLock;
      return json(200, { ...c, ...(ignored ? { userLock: true } : {}) }); // 무시한 끄기도 '꺼짐'으로 거짓 보고
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
    if (method === 'POST' && path === '/ncc/campaigns') {
      const c = { ...body, nccCampaignId: nextId('cmp'), status: 'PAUSED', sharedDailyBudget: budgetOf(body.sharedBudgetId)?.dailyBudget ?? null, ...state.createOverrides.campaign };
      state.campaigns.push(c);
      return json(200, { ...c });
    }
    if (method === 'POST' && path === '/ncc/adgroups') {
      const g = { ...body, nccAdgroupId: nextId('grp'), status: 'PAUSED', ...state.createOverrides.adgroup };
      state.adgroups.push(g);
      return json(200, { ...g });
    }
    if (method === 'POST' && path === '/ncc/keywords') {
      const made = body.map((k) => ({ ...k, nccKeywordId: nextId('nkw'), nccAdgroupId: query.nccAdgroupId, inspectStatus: 'UNDER_REVIEW', status: 'PAUSED', ...state.createOverrides.keyword }));
      state.keywords.push(...made);
      return json(200, made.map((k) => ({ ...k })));
    }
    if (method === 'POST' && path === '/ncc/ads') {
      const a = { ...body, nccAdId: nextId('nad'), inspectStatus: 'UNDER_REVIEW', status: 'PAUSED', ...(state.ignoreAdLock ? { userLock: false } : {}), ...state.createOverrides.ad };
      state.ads.push(a);
      return json(200, JSON.parse(JSON.stringify(a)));
    }
    if (method === 'GET' && path === '/ncc/adgroups') return json(200, page(state.adgroups.filter((g) => g.nccCampaignId === query.nccCampaignId), query, 'nccAdgroupId').map((g) => ({ ...g })));
    const byIds = (list, idField) => { const ids = String(query.ids).split(','); return json(200, list.filter((x) => ids.includes(x[idField])).map((x) => JSON.parse(JSON.stringify(x)))); };
    if (method === 'GET' && path === '/ncc/keywords' && query.ids !== undefined) return byIds(state.keywords, 'nccKeywordId');
    if (method === 'GET' && path === '/ncc/ads' && query.ids !== undefined) return byIds(state.ads, 'nccAdId');
    if (method === 'GET' && path === '/billing/bizmoney') return json(200, state.bizmoney);
    if (method === 'GET' && path === '/ncc/keywords') return json(200, page(state.keywords.filter((k) => k.nccAdgroupId === query.nccAdgroupId), query, 'nccKeywordId').map((k) => ({ ...k })));
    if (method === 'GET' && path === '/ncc/ads') return json(200, state.ads.filter((a) => a.nccAdgroupId === query.nccAdgroupId).map((a) => JSON.parse(JSON.stringify(a))));
    if ((m = path.match(/^\/ncc\/(campaigns|adgroups|keywords|ads)\/([^/]+)$/)) && (method === 'GET' || method === 'PUT')) {
      const e = ENTITY[m[1]];
      const row = e.list().find((x) => x[e.id] === m[2]);
      if (!row) return json(404, { code: 1002, title: 'not found' });
      const ignored = method === 'PUT' && body?.userLock === true && (state.ignorePause.has(row[e.id]) || state.ignorePauseKinds.has(m[1]));
      if (method === 'PUT' && query.fields === 'userLock' && !ignored) row.userLock = body.userLock;
      // 무시한 끄기도 응답은 '꺼짐'으로 거짓 보고한다(응답을 믿으면 안 된다 — 재조회만 사실)
      return json(200, { ...JSON.parse(JSON.stringify(row)), ...(ignored ? { userLock: true } : {}) });
    }
    if (method === 'GET' && path === '/stats') {
      const ids = String(query.ids ?? '').split(',').filter(Boolean);
      const day = (() => { try { return JSON.parse(query.timeRange ?? '{}').since ?? null; } catch { return null; } })();
      const rows = state.dailyStats.get(day);
      // 비용 질의(fields=["salesAmt"])에서는 요청한 캠페인이 활동이 없어도 0원 행으로 온다(빈 응답 = spend_unknown 판정과 맞물림, 최종 판정 A1).
      // statsOmitIdle=true면 표에 없는 id를 빼고 보낸다(네이버가 활동 없는 행을 빼는 경우 흉내). 성과 수집 질의는 표에 있는 행만.
      const known = new Set(state.campaigns.map((c) => c.nccCampaignId));
      const zeroFill = !state.statsOmitIdle && query.fields === '["salesAmt"]';
      if (rows) return json(200, { data: ids.filter((id) => rows.has(id) || (zeroFill && known.has(id))).map((id) => ({ id, ...(rows.get(id) ?? { salesAmt: 0 }) })) });
      return json(200, { data: ids.filter((id) => state.spend.has(id) || (zeroFill && known.has(id))).map((id) => ({ id, salesAmt: state.spend.get(id) ?? 0 })) });
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
