/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 설정 › GA4 Google 계정 행: 키 오류 행의 재연결·해제는 런타임 키 = DB 앵커(recoverable)일 때만, 그 외·not_configured는 경고만.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ga4OauthView } = require('../ga4-oauth-view.ts');
const pick = v => ({ status: v.status, reconnect: v.showReconnect, disconnect: v.showDisconnect });
const err = (reason, recoverable) => ga4OauthView({ connected_oauth: false, oauth_error: 'credential_storage_error', oauth_error_reason: reason, oauth_error_recoverable: recoverable });

test('key_mismatch row: buttons only when runtime kid == anchor kid', () => {
  for (const reason of ['key_mismatch', 'invalid_blob']) {
    const ok = err(reason, true);
    assert.deepEqual(pick(ok), { status: 'storage_error', reconnect: true, disconnect: true });
    assert.match(ok.warning, /관리자 설정 오류\(자격증명 키\).*재연결하거나 연결 해제/);
    const no = err(reason, false);
    assert.deepEqual(pick(no), { status: 'storage_error', reconnect: false, disconnect: false });
    assert.match(no.warning, /운영자에게 문의/);
  }
});

test('not_configured: admin warning only, even if recoverable is (wrongly) true', () => {
  for (const r of [true, false]) assert.deepEqual(pick(err('not_configured', r)), { status: 'storage_error', reconnect: false, disconnect: false });
});

test('normal states are unchanged', () => {
  const on = ga4OauthView({ connected_oauth: true, oauth_error: null, oauth_error_reason: null, oauth_error_recoverable: false });
  assert.deepEqual(pick(on), { status: 'connected', reconnect: true, disconnect: true });
  const off = ga4OauthView({ connected_oauth: false, oauth_error: null, oauth_error_reason: null, oauth_error_recoverable: false });
  assert.deepEqual(pick(off), { status: 'disconnected', reconnect: true, disconnect: false });
  assert.equal(off.warning, null);
  assert.equal(off.reconnectLabel, 'Google 계정 연결');
});
