/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test helper. */
/* global require, module */
// 광고 제안 DB 테스트 공용 준비: PGlite(ads-db.cjs) + 가짜 네이버(키워드 도구 행 3개) + 가짜 LLM(lib/claude/chat.ts getClient 대체)
// + 실제 봉인 키로 연결된 계정 1개(비즈채널은 selectChannel()로 따로 선택). 라우트 호출 헬퍼는 모든 응답에서 키·암호문 노출을 검사한다.
// 가짜 훅은 기록만 한다 — 단언은 훅 밖에서. 반환된 env.close()를 finally에서 반드시 부른다.
const assert = require('node:assert/strict');
const { setupAdsDb, request } = require('./ads-db.cjs');
const { fakeNaver } = require('./fake-naver.cjs');
const CID = '1234567', KEY = '0100000000aaaaaaaabbbbbbbbccccccccdddd1a2b', SECRET_KEY = 'AQAAAADsecretvalueSECRETVALUE9z8y==';
const CH = 'bsn-a001-00-000000015361946';
const SITE = { nccBusinessChannelId: CH, channelTp: 'SITE', name: '베스트라', channelKey: 'https://vestra.ai.kr', pcInspectStatus: 'APPROVED', mobileInspectStatus: 'APPROVED', status: 'ELIGIBLE' };
const row = (relKeyword, pc, mobile, compIdx = '중간') => ({ relKeyword, monthlyPcQcCnt: pc, monthlyMobileQcCnt: mobile, monthlyAvePcCtr: 0.5, monthlyAveMobileCtr: 1.2, plAvgDepth: 15, compIdx });
const kw = (keyword, bidAmt = 500) => ({ keyword, bidAmt, reason: '의도가 분명한 검색어' });
const CLEAN = [{ headline: '전세 계약 전 확인', description: '등기부 위험을 미리 점검하세요' }, { headline: '보증금 지키기', description: '계약 전 권리관계를 확인해 보세요' }];
const DIRTY = [{ headline: '업계 최고 1위 전세 점검', description: '보증금 100% 보장' }, CLEAN[1]];
const answer = (creatives = CLEAN) => ({ groups: [
  { name: '전세사기 예방', bidAmt: 300, keywords: [kw('전세사기'), kw('깡통전세', 200)], creatives },
  { name: '등기부 확인', bidAmt: 300, keywords: [kw('등기부등본', 300)], creatives: CLEAN },
] });

async function setupProposalsEnv(packageDir) {
  const env = await setupAdsDb(packageDir);
  try {
    const { db, client } = env;
    const naver = fakeNaver();
    naver.state.keys.set(CID, { apiKey: KEY, secretKey: SECRET_KEY });
    naver.state.channels.push(SITE);
    naver.state.keywordRows.push(row('전세사기', 900, 2100, '높음'), row('깡통전세', '< 10', '< 10'), row('등기부등본', 300, 500, '낮음'));
    env.useFetch(naver.fn);
    // 가짜 LLM(lib/claude/chat.ts getClient 대체): answers를 차례로 돌려주고 요청만 기록
    const llmCalls = [], answers = [];
    const fakeLlm = { chat: { completions: { create: async (body) => {
      llmCalls.push(body);
      const a = answers.shift();
      if (a === undefined) throw new Error('unexpected LLM call');
      return { choices: [{ message: { content: typeof a === 'string' ? a : JSON.stringify(a) } }], usage: { prompt_tokens: 2000, completion_tokens: 800, total_tokens: 2800 } };
    } } } };
    const chatPath = require.resolve('../../../claude/chat.ts');
    const realChat = require(chatPath);
    require.cache[chatPath].exports = { ...realChat, getClient: () => fakeLlm };
    const accountsRoute = require('../../../../app/api/ads/accounts/route.ts');
    const accountRoute = require('../../../../app/api/ads/accounts/[id]/route.ts');
    const list = require('../../../../app/api/ads/proposals/route.ts');
    const one = require('../../../../app/api/ads/proposals/[id]/route.ts');
    const review = require('../../../../app/api/ads/proposals/[id]/review/route.ts');
    const { MAX_SEEDS } = require('../../keywords.ts');
    const { MAX_KEYWORD_LENGTH } = require('../../keyword-text.ts');
    const { MAX_MANUAL_SEEDS, MAX_MANUAL_SEED_LENGTH } = require('../../../../schemas/ads-proposal.ts');
    const ctx = (id) => ({ params: Promise.resolve({ id }) });
    const blobs = async () => (await db.query('SELECT api_key_enc, secret_key_enc FROM ad_accounts')).rows.flatMap((r) => [r.api_key_enc, r.secret_key_enc]).filter(Boolean);
    const call = async (fn) => {
      const res = await fn();
      const text = await res.text();
      for (const needle of [KEY, SECRET_KEY, ...(await blobs()), 'apiKeyEnc', 'secretKeyEnc', 'api_key_enc', 'secret_key_enc', 'v1:'])
        assert.equal(text.includes(needle), false, `response leaks ${needle.slice(0, 10)}…`);
      return { status: res.status, body: JSON.parse(text) };
    };
    const create = (body) => call(() => list.POST(request('POST', '/api/ads/proposals', body)));
    const get = (id) => call(() => one.GET(request('GET', `/api/ads/proposals/${id}`), ctx(id)));
    const patch = (id, body) => call(() => one.PATCH(request('PATCH', `/api/ads/proposals/${id}`, body), ctx(id)));
    const decide = (id, body) => call(() => review.POST(request('POST', `/api/ads/proposals/${id}/review`, body), ctx(id)));
    const listGet = (qs = '') => call(() => list.GET(request('GET', `/api/ads/proposals${qs}`)));
    const proposalRow = async (id) => client.adProposal.findUniqueOrThrow({ where: { id } });
    const audits = async (action) => (await db.query('SELECT * FROM audit_log WHERE action=$1', [action])).rows;
    const costRows = async () => (await db.query(`SELECT * FROM cost_ledger WHERE kind='ads'`)).rows;

    // 계정 연결(실제 봉인 키) — 비즈채널은 아직 선택 안 함
    const r = await call(() => accountsRoute.POST(request('POST', '/api/ads/accounts', { customerId: CID, apiKey: KEY, secretKey: SECRET_KEY, label: '베스트라' })));
    assert.equal(r.status, 201);
    const accountId = r.body.data.account.id;
    const input = { accountId, kind: 'new_campaign', seeds: ['전세사기', '등기부등본'] };
    const selectChannel = async () => call(() => accountRoute.PATCH(request('PATCH', `/api/ads/accounts/${accountId}`, { action: 'select_channel', channelId: CH }), ctx(accountId)));
    return {
      env, naver, llmCalls, answers, accountId, input, call, create, get, patch, decide, listGet, proposalRow, audits, costRows, blobs, selectChannel,
      limits: { MAX_SEEDS, MAX_KEYWORD_LENGTH, MAX_MANUAL_SEEDS, MAX_MANUAL_SEED_LENGTH },
    };
  } catch (error) {
    await env.close();
    throw error;
  }
}

module.exports = { setupProposalsEnv, answer, kw, CLEAN, DIRTY, KEY, SECRET_KEY };
