/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, Response, __dirname */
// 등록기준 린터: 최상급·보장 표현(정규화·띄어쓰기·전각 변형), 오탐 결정, 금지 특수문자·제어·제로폭·이모지, 글자 수(NFC 코드포인트),
// 그룹 내 중복 소재(3822), 키워드 특수문자(3906)와 Task 6 키워드 정제의 동치, 입력 방어. 순수 함수 — DB·네트워크 없음.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lintCreative, lintCreativeGroup, lintKeyword } = require('../lint.ts');
const { LINT_RULES, SUPERLATIVE_TERMS } = require('../lint-rules.ts');
// 동치 테스트용 researchKeywords는 DB·세션을 쓰지 않는다: 닿으면 throw하는 함정으로 막는다.
const trap = new Proxy({}, { get: (_, key) => { throw new Error(`unexpected prisma.${String(key)}`); } });
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: trap } };
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => { throw new Error('unexpected session'); } } };
const { NaverAdsClient } = require('../../external/naver-searchad.ts');
const { researchKeywords } = require('../keywords.ts');

const rules = (issues) => issues.map((i) => i.rule);
const has = (issues, rule, field) => issues.some((i) => i.rule === rule && (!field || i.field === field));
// 메시지에 원문 제어·보이지 않는 문자가 섞이면 안 된다(린터 데이터와 독립적인 판정)
const invisible = (c) => { const o = c.codePointAt(0); return o < 0x20 || (o >= 0x7f && o <= 0x9f) || (o >= 0x200b && o <= 0x200f) || o === 0x2060 || o === 0xfeff || (o >= 0xfe00 && o <= 0xfe0f); };
const ok = { headline: '전세 계약 전 확인', description: '등기부와 시세를 한 번에 확인하세요' };

test('clean copy passes', () => {
  assert.deepEqual(lintCreative(ok), []);
  assert.deepEqual(lintKeyword('전세사기'), []);
  assert.deepEqual(lintKeyword('전세 사기 예방'), []);
});

test('flags superlatives', () => {
  for (const [headline, term] of [['업계 최고 서비스', '최고'], ['만족도 1위 앱', '1위'], ['100% 환불', '100%'], ['결과 보장', '보장'],
    ['국내 유일 플랫폼', '유일'], ['최상의 선택', '최상'], ['No.1 플랫폼', 'no.1'], ['완벽한 분석', '완벽']]) {
    const issues = lintCreative({ headline, description: ok.description });
    assert.ok(has(issues, 'superlative', 'headline'), `${headline} → superlative`);
    assert.ok(issues.find((i) => i.rule === 'superlative').message.includes(term) || term === 'no.1', headline);
  }
  assert.ok(has(lintCreative({ headline: ok.headline, description: '최저가 보장 이벤트' }), 'superlative', 'description'));
});

test('superlatives match spacing, full-width, case and zero-width variants; report the original text', () => {
  const cases = [['만족도 1 위', '1 위'], ['１００％ 만족', '１００％'], ['100 % 환불', '100 %'], ['업계 최 고', '최 고'],
    ['NO.1 앱', 'NO.1'], ['ｎｏ．１ 앱', 'ｎｏ．１'], ['보\u200B장 상품', '보장']];
  for (const [headline, shown] of cases) {
    const issue = lintCreative({ headline, description: ok.description }).find((i) => i.rule === 'superlative');
    assert.ok(issue, `${JSON.stringify(headline)} → superlative`);
    assert.ok(issue.message.includes(`'${shown}'`), `${issue.message} should quote ${shown}`);
    assert.ok(!issue.message.includes('\u200B'), 'zero-width must not be echoed');
  }
});

test('false-positive decisions: 보장성 보험·최고경영자·21위 pass; 최고급·유일하게 are flagged', () => {
  for (const headline of ['보장성 보험 비교', '보장성보험 상담', '최고경영자 과정', '순위 21위 기록', '1000% 성장', '7100%']) {
    assert.ok(!has(lintCreative({ headline, description: ok.description }), 'superlative'), `${headline} must not be superlative`);
  }
  for (const headline of ['최고급 원두', '유일하게 24시간', '보장성 보험 보장']) {
    assert.ok(has(lintCreative({ headline, description: ok.description }), 'superlative'), `${headline} must be superlative`);
  }
});

test('every superlative term matches its own normalized form (dictionary sanity)', () => {
  for (const t of SUPERLATIVE_TERMS) {
    assert.ok(has(lintCreative({ headline: t.term, description: ok.description }), 'superlative'), t.term);
  }
});

test('flags length over limit (code points after NFC; limits come from rule data)', () => {
  const h = LINT_RULES.headlineLength.limit, d = LINT_RULES.descriptionLength.limit;
  assert.equal(h, 15);
  assert.equal(d, 45);
  assert.deepEqual(lintCreative({ headline: '가'.repeat(h), description: '나'.repeat(d) }), []);
  const over = lintCreative({ headline: '가'.repeat(h + 1), description: '나'.repeat(d + 1) });
  assert.ok(has(over, 'headline-length', 'headline'));
  assert.ok(has(over, 'description-length', 'description'));
  assert.ok(over.find((i) => i.rule === 'headline-length').message.includes(`${h + 1}`));
  // NFD 한글 15자(자모 45 코드포인트)는 NFC 15자로 센다
  assert.deepEqual(lintCreative({ headline: '가'.repeat(h).normalize('NFD'), description: ok.description }), []);
  // 서로게이트 쌍(𠀀)은 1자
  assert.ok(!has(lintCreative({ headline: '\u{20000}'.repeat(h), description: ok.description }), 'headline-length'));
});

test('length rules are marked unverified design assumptions; every rule carries its metadata', () => {
  for (const key of ['headlineLength', 'descriptionLength']) {
    assert.equal(LINT_RULES[key].verifiedAt, null);
    assert.equal(LINT_RULES[key].source, '설계 가정');
  }
  for (const [key, r] of Object.entries(LINT_RULES)) {
    for (const f of ['id', 'description', 'basis', 'source']) assert.equal(typeof r[f], 'string', `${key}.${f}`);
    assert.ok(r.verifiedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(r.verifiedAt), key);
  }
});

test('NFD input is normalized: superlatives match and clean NFD copy passes', () => {
  assert.ok(has(lintCreative({ headline: '업계 최고'.normalize('NFD'), description: ok.description }), 'superlative'));
  assert.deepEqual(lintCreative({ headline: ok.headline.normalize('NFD'), description: ok.description.normalize('NFD') }), []);
});

test('forbidden special chars, control, zero-width and emoji are flagged without echoing invisibles', () => {
  const star = lintCreative({ headline: '★특가★ 전세 점검', description: ok.description });
  assert.ok(has(star, 'forbidden-char', 'headline'));
  assert.ok(star.find((i) => i.rule === 'forbidden-char').message.includes('★'));
  const cases = [['전세\u0007점검', 'control-char', 'U+0007'], ['전세\n점검', 'control-char', 'U+000A'], ['전세\u200B점검', 'zero-width-char', 'U+200B'],
    ['전세\u200D점검', 'zero-width-char', 'U+200D'], ['\uFEFF전세점검', 'zero-width-char', 'U+FEFF'], ['전세 점검 🏠', 'emoji', null], ['좋아요 ❤\uFE0F', 'emoji', null]];
  for (const [headline, rule, code] of cases) {
    const issues = lintCreative({ headline, description: ok.description });
    const issue = issues.find((i) => i.rule === rule);
    assert.ok(issue, `${JSON.stringify(headline)} → ${rule}`);
    if (code) assert.ok(issue.message.includes(code), issue.message);
    for (const i of issues) assert.ok(![...i.message].some(invisible), `message echoes invisible: ${JSON.stringify(i.message)}`);
  }
  // 일반 문장부호는 허용
  assert.deepEqual(lintCreative({ headline: '전세, 안전하게!', description: '시세·등기부(무료) 확인 - 3분이면 끝? "지금" 10% 할인' }), []);
});

test('input hardening: non-string, empty and overly long input are issues, not crashes', () => {
  for (const bad of [undefined, null, 42, {}, ['a']]) {
    const issues = lintCreative({ headline: bad, description: bad });
    assert.ok(has(issues, 'input-type', 'headline') && has(issues, 'input-type', 'description'), String(bad));
    assert.ok(has(lintKeyword(bad), 'input-type', 'keyword'));
  }
  assert.ok(has(lintCreative(null), 'input-type', 'headline'));
  assert.ok(has(lintCreative({ headline: '   ', description: ok.description }), 'required', 'headline'));
  const huge = '최고'.repeat(600);
  const issues = lintCreative({ headline: huge, description: ok.description });
  assert.deepEqual(rules(issues), ['input-too-long']);
  assert.deepEqual(rules(lintKeyword('가'.repeat(1001))), ['input-too-long']);
});

test('duplicate creative in group (3822): NFC + whitespace-collapsed + case-folded', () => {
  const a = { headline: 'Vestra 전세 점검', description: '등기부와 시세를 한 번에' };
  const b = { headline: ' vestra   전세 점검'.normalize('NFD'), description: '등기부와  시세를 한 번에 ' };
  const c = { headline: 'Vestra 전세 점검', description: '다른 설명입니다' };
  const out = lintCreativeGroup([a, b, c, a]);
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], []);
  assert.ok(has(out[1], 'duplicate-creative'));
  assert.ok(out[1].find((i) => i.rule === 'duplicate-creative').message.includes('1번째'));
  assert.deepEqual(out[2], []);
  assert.ok(has(out[3], 'duplicate-creative'));
  // 각 소재의 개별 규칙도 함께 돌린다
  assert.ok(has(lintCreativeGroup([{ headline: '최고 서비스', description: ok.description }])[0], 'superlative'));
  // 형식이 깨진 소재는 중복 비교에서 빠지지만 크래시하지 않는다
  const broken = lintCreativeGroup([{ headline: 1 }, { headline: 1 }]);
  assert.ok(broken.every((r) => has(r, 'input-type') && !has(r, 'duplicate-creative')));
  assert.ok(has(lintCreativeGroup('nope')[0], 'input-type'));
});

test('flags keyword special chars (3906)', () => {
  for (const kw of ['전세!', 'naver.com', '전세#사기', '★전세', '전세🏠', 'ㅋㅋ전세', 'ＡＢＣ', '전세\u200B사기']) {
    const issues = lintKeyword(kw);
    assert.ok(has(issues, 'keyword-special-char', 'keyword'), kw);
    assert.ok(issues[0].message.includes('3906'));
  }
  assert.ok(has(lintKeyword('   '), 'keyword-empty'));
  assert.ok(has(lintKeyword('가'.repeat(LINT_RULES.keywordLength.limit + 1)), 'keyword-length'));
  assert.deepEqual(lintKeyword('가'.repeat(LINT_RULES.keywordLength.limit)), []);
});

// 한 표가 Task 6 정제(researchKeywords 결과 필터)와 lintKeyword 둘 다를 구동한다 — 두 규칙이 어긋나면 여기서 깨진다.
const KEYWORD_TABLE = [
  ['전세사기', true], ['전세 사기', true], ['  전세   사기  ', true], ['Vestra2', true], ['전세사기'.normalize('NFD'), true],
  ['전세!', false], ['naver.com', false], ['a-b', false], ['전세\t사기', true], ['ㅋㅋ', false], ['ＡＢＣ', false],
  ['전세🏠', false], ['전세\u200B사기', false], ['', false], ['   ', false], ['漢字', false], ['é', false],
];

test('keyword rule parity with Task 6 (one table drives both)', async () => {
  const transport = async () => new Response(JSON.stringify({ keywordList: KEYWORD_TABLE.map(([k]) => ({ relKeyword: k, monthlyPcQcCnt: 10, monthlyMobileQcCnt: 10 })) }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  const client = new NaverAdsClient({ customerId: '1', apiKey: 'TEST-k', secretKey: 'TEST-s' }, transport);
  const kept = new Set((await researchKeywords(client, ['씨앗'])).map((s) => s.keyword));
  for (const [kw, valid] of KEYWORD_TABLE) {
    const nk = kw.normalize('NFC').trim().replace(/\s+/g, ' ');
    const lintValid = lintKeyword(kw).length === 0;
    assert.equal(lintValid, valid, `lint ${JSON.stringify(kw)}`);
    if (valid) assert.ok(kept.has(nk) || [...kept].some((k) => k.replace(/ /g, '').toLowerCase() === nk.replace(/ /g, '').toLowerCase()), `task6 keeps ${JSON.stringify(kw)}`);
    else assert.ok(!kept.has(nk), `task6 drops ${JSON.stringify(kw)}`);
  }
});

// 금지 키워드 사전(3909): 정규화(NFC·전각→반각·소문자·공백 정리) 후 토큰 경계에 맞는 연속 토큰(공백 제거해 이어 붙임)이 사전어와 같을 때만 잡는다.
test('forbidden keyword dictionary (3909): spacing and full-width variants are flagged', () => {
  const { FORBIDDEN_KEYWORDS } = require('../lint-rules.ts');
  assert.equal(LINT_RULES.forbiddenKeyword.verifiedAt, null);
  assert.equal(LINT_RULES.forbiddenKeyword.source, '설계 가정');
  for (const kw of ['원금보장', '원금 보장', '원금보장 투자', '고수익 원금보장', '확정수익', '확정 수익 상품', 'ＡＢＣ 확정수익', '작업대출', '대포통장'.normalize('NFD')]) {
    const issue = lintKeyword(kw).find((i) => i.rule === 'forbidden-keyword');
    assert.ok(issue, `${kw} → forbidden-keyword`);
    assert.ok(issue.message.includes('3909'));
  }
  // 전각 영문 사전어도 같은 정규화로 잡는다(사전 자기 일치)
  for (const term of FORBIDDEN_KEYWORDS) assert.ok(has(lintKeyword(term), 'forbidden-keyword'), term);
});

test('forbidden keyword matching is whole-term: a token that merely contains a term passes', () => {
  for (const kw of ['대포통장신고', '원금보장형예금', '확정수익률', '작업대출피해상담', '전세사기', '원금 상환']) {
    assert.ok(!has(lintKeyword(kw), 'forbidden-keyword'), `${kw} must not be forbidden`);
  }
});

// Trojan Source 방지: 린터 소스에 보이지 않는 문자(형식 Cf — 양방향 제어·제로폭·BOM 포함, 줄/문단 구분자, 일반 공백 외 Zs, 탭·줄바꿈 외 제어)가
// 원문으로 들어가면 안 된다. 이런 문자는 반드시 이스케이프나 코드 범위 데이터로 쓴다.
test('linter sources contain no literal invisible, format or bidi characters', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const hidden = (ch) => /[\p{Cf}\p{Zl}\p{Zp}]/u.test(ch) || (/\p{Zs}/u.test(ch) && ch !== ' ') || (/\p{Cc}/u.test(ch) && !'\t\n\r'.includes(ch));
  for (const file of ['lint-rules.ts', 'lint.ts', 'keyword-text.ts']) {
    const lines = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').split('\n');
    const found = [];
    lines.forEach((line, n) => { for (const ch of line) if (hidden(ch)) found.push(`${file}:${n + 1} U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`); });
    assert.deepEqual(found, [], `literal invisible characters in ${file}`);
  }
});
