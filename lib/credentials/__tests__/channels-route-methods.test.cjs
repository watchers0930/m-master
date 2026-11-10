/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// /api/channels 는 POST(저장)·DELETE(해제)만 노출한다. 클라이언트가 쓰지 않는 GET은 제거됨(2026-11-10 결정).
// 서버 렌더(channels-view)가 listMaskedCredentials를 직접 쓰므로 HTTP GET 경로는 불필요한 공격면이다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../../auth.ts')] = { exports: { requireSession: async () => ({ user: { id: 'o' } }) } };
require.cache[require.resolve('../../audit/logger.ts')] = { exports: { logAudit: async () => {} } };
require.cache[require.resolve('../../prisma.ts')] = { exports: { prisma: {} } };
const channels = require('../../../app/api/channels/route.ts');

test('/api/channels exposes only POST and DELETE', () => {
  assert.equal(channels.GET, undefined);
  assert.equal(typeof channels.POST, 'function');
  assert.equal(typeof channels.DELETE, 'function');
});
