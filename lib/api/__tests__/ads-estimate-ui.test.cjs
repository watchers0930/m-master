/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// 예상 순위 화면(B4) — 표시 문구(lib/api/ads-format.ts 순수 함수) + 배선(렌더 환경이 없어 소스로 확인).
// - 버튼을 눌렀을 때만 부른다(useMutation, 페이지 로드·useEffect·useQuery 없음). 요청은 아무 입력도 보내지 않는다.
// - '상한 초과'는 서버 bidRange.max와 비교하는 exceedsBidRange 하나로만 판정한다(컴포넌트는 직접 비교하지 않는다).
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const f = require('../ads-format.ts');
const ROOT = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const C = (name) => read(`app/(dashboard)/ads/components/${name}`);

test('exceedsBidRange: strictly above the server max; unknown range never flags', () => {
  const range = { min: 70, max: 1000 };
  assert.equal(f.exceedsBidRange(1000, range), false, '같으면 허용 안');
  assert.equal(f.exceedsBidRange(1001, range), true);
  assert.equal(f.exceedsBidRange(70, range), false);
  assert.equal(f.exceedsBidRange(5000, null), false);
});

test('labels: expected positions and the 1–5위 line with the over-ceiling marker', () => {
  assert.equal(f.expectedSummary({ PC: 4, MOBILE: 1 }), 'PC 약 4위 · 모바일 약 1위');
  assert.equal(f.expectedSummary({ PC: '6위 이하', MOBILE: null }), 'PC 6위 이하 · 모바일 확인 못 함');
  assert.equal(
    f.positionBidsLabel({ 1: 1350, 2: 900, 4: 450, 5: 300 }, { min: 70, max: 1000 }),
    '1위 1,350원(상한 초과) · 2위 900원 · 3위 — · 4위 450원 · 5위 300원',
  );
  assert.equal(f.positionBidsLabel({ 1: 1350 }, null), '1위 1,350원 · 2위 — · 3위 — · 4위 — · 5위 —');
});

test('wiring: detail page shows the estimate card; the call happens only on click and sends no input', () => {
  assert.match(C('ProposalDetail.tsx'), /<ProposalEstimate proposalId=\{proposal\.id\} dirty=\{dirty\} \/>/);
  const card = C('ProposalEstimate.tsx');
  assert.match(card, /onClick=\{\(\) => estimate\.mutate\(\)\}/);
  assert.match(card, />\s*\{estimate\.isPending \? '조회 중…' : '예상 순위 조회'\}/);
  assert.doesNotMatch(card, /useEffect|useQuery|\.mutate\([^)]/, '로드 시 호출·입력 전달 없음');
  assert.match(card, /errorView\(estimate\.error\)/);
  assert.match(card, /estimate\.isPending && </);
  const hook = read('hooks/useAdsProposal.ts');
  const block = hook.slice(hook.indexOf('export function useAdsProposalEstimate'));
  assert.match(block, /useMutation\(\{ mutationFn: \(\) => getAdProposalEstimate\(id\), retry: false \}\)/);
  assert.match(read('lib/api/ads.ts'), /getAdProposalEstimate = \(id: string\) => send<ProposalEstimateDTO>\(`\/api\/ads\/proposals\/\$\{seg\(id\)\}\/estimate`, \{ method: 'POST' \}\);/, 'POST, 본문 없음');
});

test('every over-ceiling check goes through exceedsBidRange (no direct max comparisons in ads components)', () => {
  const fmt = read('lib/api/ads-format.ts');
  assert.equal((fmt.match(/>\s*range\.max/g) ?? []).length, 1, 'ads-format 안에서도 한 곳');
  assert.match(fmt, /exceedsBidRange\(bid, range\) \? '\(상한 초과\)'/);
  for (const name of fs.readdirSync(path.join(ROOT, 'app/(dashboard)/ads/components')))
    assert.doesNotMatch(C(name), /[<>]=?\s*(?:\w+\.)?(?:bidRange|range)\??\.max\b|\.max\s*[<>]/, `${name}: 상한 비교는 exceedsBidRange`);
});
