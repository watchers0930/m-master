/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test helper. */
/* global require, module, process */
// 제안 적용·켜기/끄기 DB 테스트 공용 준비: proposals-env(PGlite + 가짜 네이버 + 실제 봉인 키 계정, 비즈채널 선택까지)
// + 승인된 제안 행(Prisma) 생성 + 적용·잠금 라우트 호출 헬퍼. 비상 정지 스위치는 켠 상태(ADS_EXECUTION_ENABLED=true)로 시작한다.
// 가짜 훅은 기록·장애 주입만 한다 — 단언은 훅 밖에서. 반환된 env.close()를 finally에서 반드시 부른다.
const assert = require('node:assert/strict');
const { request } = require('./ads-db.cjs');
const { setupProposalsEnv, CLEAN } = require('./proposals-env.cjs');

const ev = { qc: 100, compIdx: '중간', lt10: false };
const k = (keyword, bidAmt = 300) => ({ keyword, bidAmt, reason: '근거', evidence: ev });
// 그룹 2개 · 키워드 3개 · 소재 4개(그룹마다 2개)
const PAYLOAD = { groups: [
  { name: '전세사기 예방', bidAmt: 300, keywords: [k('전세사기'), k('깡통전세', 200)], creatives: CLEAN },
  { name: '등기부 확인', bidAmt: 250, keywords: [k('등기부등본')], creatives: CLEAN },
] };
const EXTRA = [{ headline: '등기부 위험 확인', description: '계약 전에 권리관계를 점검하세요' }, { headline: '전세 보증금 점검', description: '근저당과 압류를 미리 확인해 보세요' }];

async function setupApplyEnv(packageDir) {
  const p = await setupProposalsEnv(packageDir);
  try {
    assert.equal((await p.selectChannel()).status, 200);
    process.env.ADS_EXECUTION_ENABLED = 'true';
    const { client } = p.env;
    const applyRoute = require('../../../../app/api/ads/proposals/[id]/apply/route.ts');
    const lockRoute = require('../../../../app/api/ads/entities/[type]/[id]/lock/route.ts');
    const account = () => client.adAccount.findUniqueOrThrow({ where: { id: p.accountId } });
    const approved = async ({ kind = 'new_campaign', payload = PAYLOAD, targetAdgroupId = null, ownerId = 'owner', adAccountId = p.accountId } = {}) =>
      client.adProposal.create({ data: { ownerId, adAccountId, kind, targetAdgroupId, status: 'approved', payload, lintResult: { issues: [], checkedAt: new Date().toISOString() } } });
    const apply = (id) => p.call(() => applyRoute.POST(request('POST', `/api/ads/proposals/${id}/apply`), { params: Promise.resolve({ id }) }));
    const lock = (type, id, body) => p.call(() => lockRoute.POST(request('POST', `/api/ads/entities/${type}/${id}/lock`, body), { params: Promise.resolve({ type, id }) }));
    const posts = (re) => p.naver.count('POST', re);
    const puts = (re) => p.naver.state.calls.filter((c) => c.method === 'PUT' && re.test(c.path));
    const mirrors = async (proposalId) => ({
      campaigns: await client.adCampaign.findMany({ where: { proposalId }, orderBy: { name: 'asc' } }),
      groups: await client.adGroup.findMany({ where: { proposalId }, orderBy: { name: 'asc' } }),
      keywords: await client.adKeyword.findMany({ where: { proposalId }, orderBy: { keyword: 'asc' } }),
      creatives: await client.adCreative.findMany({ where: { proposalId }, orderBy: { slot: 'asc' } }),
    });
    const resetFaults = () => { p.naver.state.hooks = {}; p.naver.state.createOverrides = {}; p.naver.state.ignoreAdLock = false; p.naver.state.ignorePause.clear(); p.naver.state.ignorePauseKinds.clear(); };
    return { ...p, account, approved, apply, lock, posts, puts, mirrors, resetFaults };
  } catch (error) {
    await p.env.close();
    throw error;
  }
}

module.exports = { setupApplyEnv, PAYLOAD, EXTRA, k };
