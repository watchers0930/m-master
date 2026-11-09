/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 설정 › GA4 Google 계정 행: 키 오류에도 '연결 해제'는 항상, 재연결은 env 문제(not_configured)일 때만 숨김.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ga4OauthView, CREDENTIAL_STORAGE_WARNING } = require('../ga4-oauth-view.ts');
const pick = v => ({ status: v.status, reconnect: v.showReconnect, disconnect: v.showDisconnect });

test('storage error keeps disconnect; reconnect hidden only for not_configured', () => {
  const env = ga4OauthView({ connected_oauth: false, oauth_error: 'credential_storage_error', oauth_error_reason: 'not_configured' });
  assert.deepEqual(pick(env), { status: 'storage_error', reconnect: false, disconnect: true });
  assert.ok(env.warning.startsWith(CREDENTIAL_STORAGE_WARNING));
  for (const reason of ['key_mismatch', 'invalid_blob']) {
    const v = ga4OauthView({ connected_oauth: false, oauth_error: 'credential_storage_error', oauth_error_reason: reason });
    assert.deepEqual(pick(v), { status: 'storage_error', reconnect: true, disconnect: true });
    assert.match(v.warning, /관리자 설정 오류\(자격증명 키\)/);
  }
});

test('normal states are unchanged', () => {
  assert.deepEqual(pick(ga4OauthView({ connected_oauth: true, oauth_error: null, oauth_error_reason: null })), { status: 'connected', reconnect: true, disconnect: true });
  const off = ga4OauthView({ connected_oauth: false, oauth_error: null, oauth_error_reason: null });
  assert.deepEqual(pick(off), { status: 'disconnected', reconnect: true, disconnect: false });
  assert.equal(off.warning, null);
  assert.equal(off.reconnectLabel, 'Google 계정 연결');
});
