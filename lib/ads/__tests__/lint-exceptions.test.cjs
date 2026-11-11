/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// D3: 부동산 사실 용어(최고가·최상층·보장금액)는 최상급 주장이 아니다(대장 결정 2026-11-12). '최초'·'최고'와
// 부호·띄어쓰기 우회('최.고'·'최고 가성비')는 계속 잡는다. 순수 함수 — DB·네트워크 없음.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lintCreative } = require('../lint.ts');
const { SUPERLATIVE_EXCEPTIONS } = require('../lint-rules.ts');

const description = '실거래가와 등기부를 한 번에 확인하세요';
const superlative = (headline) => lintCreative({ headline, description }).filter((i) => i.rule === 'superlative');

test('부동산 사실 용어는 최상급이 아니다: 최고가·최상층·보장금액', () => {
  for (const headline of ['역대 최고가 경신 단지', '최상층 전망 매물', '보장금액 확인하기', '실거래 최고가 대비', '최고가,최상층']) {
    assert.deepEqual(superlative(headline), [], `${headline} must not be superlative`);
  }
});

test("'최초'·'최고'와 우회 변형은 계속 잡는다", () => {
  for (const headline of ['국내 최초 전세 진단', '최고의 매물', '최.고 매물', '최-고 단지', '최초 공개 최고가', '최고 가성비 단지', '최고가성비 단지',
    '최고가치 매물', '최.고가 경신', '수익보장금액 안내', '원금 보장금액', '최상 층간소음 차단']) {
    assert.ok(superlative(headline).length > 0, `${headline} must be superlative`);
  }
});

test('같은 문구 안의 다른 최상급은 예외에 묻히지 않는다', () => {
  const quoted = superlative('최고가 단지 최초 공개').map((i) => i.message);
  assert.equal(quoted.length, 1);
  assert.ok(quoted[0].includes("'최초'"), quoted[0]);
});

test('예외는 근거·확인일을 가진 데이터다(lint-rules.ts)', () => {
  const byTerm = new Map(SUPERLATIVE_EXCEPTIONS.map((e) => [e.term, e]));
  for (const term of ['최고가', '최상층', '보장금액']) {
    const e = byTerm.get(term);
    assert.ok(e, `${term} exception exists`);
    assert.equal(e.verifiedAt, null);
    assert.equal(e.source, '대장 결정 2026-11-12');
    assert.ok(e.pattern instanceof RegExp && e.pattern.global, `${term} pattern is a global RegExp`);
  }
  assert.equal(byTerm.has('최초'), false);
  for (const e of SUPERLATIVE_EXCEPTIONS) assert.ok(e.term && e.basis && 'verifiedAt' in e && e.source, `${e.term} has provenance`);
});

test('기존 예외(보장성·최고경영자)는 b9b835a 와 같게 — 띄어쓴 형태·붙여 쓴 형태 모두 통과(정규화 기준)', () => {
  // b9b835a 린터와 대조한 값(보고서 D3 재수정 표): 이전 버전에서 모두 superlative 아님
  for (const headline of ['보장성 보험', '보장성보험', '보장 성 보험', '보.장성', '최고경영자 과정', '최고 경영자 과정', '최고경영 자', '최.고경영자', '최​고경영자']) {
    assert.deepEqual(superlative(headline), [], `${headline} must not be superlative (b9b835a 동작)`);
  }
  for (const headline of ['최.고 매물', '최 고 매물', '최​고', '국내 최초', '보장성 보험 보장']) {
    assert.ok(superlative(headline).length > 0, `${headline} must be superlative`);
  }
});
