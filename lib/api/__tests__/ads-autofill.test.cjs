/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// 연결·키 교체 폼의 브라우저 자동완성 차단(실운영 2026-11-11: 웨일이 MINTEQ 로그인 이메일을 고객 ID에, 로그인 비밀번호를 API 키에 채움).
// 렌더 환경이 없어 소스로 확인한다: 고객 ID = autoComplete off + name naver-customer-id + inputMode numeric,
// API 키·비밀키 = type password + autoComplete new-password + 로그인 아닌 name·id. 폼 어디에도 username·email·password 이름이 없다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DIR = path.resolve(__dirname, '../../../app/(dashboard)/ads/components');
const C = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const inputs = (src) => src.match(/<input\b[\s\S]*?\/>/g) ?? [];
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|\\{\`([^\`]*)\`\\}|\\{([^}]*)\\})`))?.slice(1).find((v) => v !== undefined);

test('customer id input is not a username field', () => {
  const tags = inputs(C('ConnectForm.tsx'));
  const customer = tags.find((t) => /setCustomerId/.test(t));
  assert.ok(customer, '고객 ID 입력');
  assert.deepEqual([attr(customer, 'autoComplete'), attr(customer, 'name'), attr(customer, 'inputMode'), attr(customer, 'type')], ['off', 'naver-customer-id', 'numeric', 'text']);
  const label = tags.find((t) => /setLabel/.test(t));
  assert.deepEqual([attr(label, 'autoComplete'), attr(label, 'name')], ['off', 'naver-account-label']);
});

test('API key and secret inputs ask for a new password under non-login names and ids', () => {
  const tags = inputs(C('KeyFields.tsx'));
  assert.equal(tags.length, 2);
  const want = [['naver-api-key', 'naver-api-key-${uid}'], ['naver-secret-key', 'naver-secret-key-${uid}']];
  for (const [i, tag] of tags.entries()) {
    assert.deepEqual([attr(tag, 'type'), attr(tag, 'autoComplete'), attr(tag, 'name'), attr(tag, 'id')], ['password', 'new-password', ...want[i]]);
    assert.match(tag, /\{\.\.\.NO_AUTOFILL\}/, '비밀번호 관리자 확장 무시 표시');
  }
  assert.match(C('KeyFields.tsx'), /useId\(\)/, '카드마다 id가 겹치지 않는다');
});

test('no ads form looks like a login form', () => {
  for (const f of ['ConnectForm.tsx', 'KeyFields.tsx', 'AccountCard.tsx']) {
    const src = C(f);
    for (const tag of [...inputs(src), ...(src.match(/<form\b[^>]*>/g) ?? [])]) {
      for (const a of ['name', 'id', 'autoComplete']) {
        const v = attr(tag, a) ?? '';
        assert.doesNotMatch(v, /^(username|email|password|current-password|user|login)$/i, `${f}: ${a}=${v}`);
      }
    }
    for (const form of src.match(/<form\b[^>]*>/g) ?? []) assert.equal(attr(form, 'autoComplete'), 'off', `${f} form autoComplete off`);
  }
  assert.match(C('AccountCard.tsx'), /<KeyFields /, '키 교체도 같은 입력칸');
});
