/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 안전 표시 규칙(lib/api/ads-safety.ts, 최종 판정 B1~B4) — 순수 함수.
// - 경보 배너: pause_failed(paused:false)·guard_blind는 urgent, 미발송이면 '메일 미발송'. 오래된 감시 스냅샷은 '감시 멈춤' 경고.
// - 엔티티: pauseUnconfirmed면 '켜짐'(녹색)이 아니라 '꺼지지 않았을 수 있음 — 네이버에서 직접 확인'(danger).
// - 끄기 요청(locked:true)의 실패는 원인과 무관하게 urgent "네이버 화면에서 지금 바로 직접 꺼 주세요". 켜기 실패는 재끄기 실패(paused:false)일 때 urgent.
// - 해제 중 계정: 경고, 10분 넘게 멈추면 urgent + 다시 시도 안내.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../ads-safety.ts');
const f = require('../ads-format.ts');

const alert = (type, extra = {}) => ({ type, at: '2026-03-10T02:00:00.000Z', sent: true, reason: null, entity: null, naverId: null, field: null, paused: null, pauseFailed: null, ...extra });
const snap = (ageMinutes) => ({ at: ageMinutes === null ? null : '2026-03-10T02:00:00.000Z', ageMinutes, spendKrw: 1, bizmoneyKrw: 1 });
const URGENT = '네이버 화면에서 지금 바로 직접 꺼 주세요';

test('safety banner: urgent pause failure and blind guard, unsent marker, cap/drift/inspect warnings', () => {
  const items = s.safetyNotices([
    alert('ads.pause_failed', { reason: 'cap_100', entity: 'campaign', naverId: 'cmp-1', paused: false, sent: false }),
    alert('ads.guard_blind', { reason: 'spend_unknown' }),
    alert('ads.cap_100', { pauseFailed: 1 }),
    alert('ads.cap_100', { pauseFailed: 0 }),
    alert('ads.drift', { entity: 'adgroup', naverId: 'grp-1', field: 'aiAdsOptIn', paused: true }),
    alert('ads.inspect_denied', { entity: 'keyword', naverId: 'kw-1' }),
  ], snap(10));
  assert.deepEqual(items.map((i) => i.urgent), [true, true, true, false, false, false]);
  assert.ok(items[0].message.includes(URGENT) && items[0].message.includes('cmp-1') && items[0].message.includes('메일 미발송'));
  assert.equal(items[1].message.includes('메일 미발송'), false);
  assert.ok(items[1].message.includes('오늘 비용'), items[1].message);
  assert.ok(items[2].message.includes('1개') && items[2].message.includes('직접 꺼'));
  assert.ok(items[4].message.includes('aiAdsOptIn'));
  assert.ok(items[5].message.includes('kw-1'));
});

test('guard_blind reasons each have their own copy (incl. disconnect_stuck and scan_truncated); pause_failed paused:true is not urgent', () => {
  const reasons = ['spend_unknown', 'deadline', 'campaign_list_incomplete', 'credential_unavailable', 'client_unavailable', 'guard_error', 'disconnect_stuck', 'scan_truncated'];
  const msgs = reasons.map((reason) => s.safetyNotices([alert('ads.guard_blind', { reason })], snap(1))[0]);
  assert.ok(msgs.every((m) => m.urgent));
  assert.equal(new Set(msgs.map((m) => m.message)).size, reasons.length);
  const repaused = s.safetyNotices([alert('ads.pause_failed', { reason: 'resume_race', naverId: 'cmp-2', paused: true })], snap(1))[0];
  assert.equal(repaused.urgent, false);
});

test('stale or missing guard snapshot is a warning; fresh is silent; the list is capped with a remainder line', () => {
  assert.deepEqual(s.safetyNotices([], snap(10)), []);
  const stale = s.safetyNotices([], snap(s.GUARD_STALE_MINUTES + 1));
  assert.equal(stale.length, 1);
  assert.ok(stale[0].message.includes('감시'), stale[0].message);
  assert.equal(s.safetyNotices([], snap(null))[0].urgent, false);
  const many = s.safetyNotices(Array.from({ length: s.MAX_NOTICES + 3 }, (_, i) => alert('ads.inspect_denied', { naverId: `kw-${i}` })), snap(1));
  assert.equal(many.length, s.MAX_NOTICES + 1);
  assert.ok(many.at(-1).message.includes('3건'));
});

test('entity badge: pauseUnconfirmed beats "켜짐"; recent alerts per naverId', () => {
  assert.deepEqual(f.lockLabel(false, null, true), { text: '꺼지지 않았을 수 있음 — 네이버에서 직접 확인', tone: 'danger' });
  assert.deepEqual(f.lockLabel(false, null), { text: '켜짐', tone: 'on' });
  assert.equal(f.lockLabel(true, 'guard', true).tone, 'guard', '꺼짐이 확인되면 그 표시');
  const b = s.alertBadges([alert('ads.drift', { naverId: 'cmp-1' }), alert('ads.pause_failed', { naverId: 'cmp-1', paused: false }), alert('ads.inspect_denied', { naverId: 'kw-1' }), alert('ads.guard_blind', { reason: 'deadline' })]);
  assert.deepEqual(b.get('cmp-1'), [{ text: '끄기 미확인', urgent: true }, { text: '설정 드리프트', urgent: false }], 'urgent 먼저');
  assert.deepEqual(b.get('kw-1'), [{ text: '검수 반려', urgent: false }]);
  assert.equal(b.size, 2);
});

test('lock errors: every failure of a pause request is urgent; resume failures are urgent only when the re-pause failed', () => {
  const e = (code, details) => ({ code, message: '서버 문구', status: 500, details });
  for (const code of ['ads_unavailable', 'ads_uncertain', 'ads_rate_limited', 'ads_key_invalid', 'ads_forbidden', 'credential_storage_unavailable', 'internal_error', 'pause_unconfirmed', 'not_found', '']) {
    const v = s.lockErrorView(e(code), true);
    assert.equal(v.urgent, true, code);
    assert.ok(v.message.includes(URGENT), code);
  }
  assert.equal(s.lockErrorView(new Error('network'), true).urgent, true, '네트워크 실패도');
  assert.ok(s.lockErrorView(e('keys_removed'), true).message.includes('서버 문구'), '키 삭제는 서버 안내를 urgent로');
  assert.equal(s.lockErrorView(e('resume_race', { paused: false }), false).urgent, true);
  assert.ok(s.lockErrorView(e('resume_race', { paused: false }), false).message.includes(URGENT));
  assert.equal(s.lockErrorView(e('resume_race', { paused: true }), false).urgent, false);
  assert.equal(s.lockErrorView(e('ads_uncertain', { paused: false }), false).urgent, true);
  assert.equal(s.lockErrorView(e('ads_uncertain', { paused: true }), false).urgent, false);
  assert.equal(s.lockErrorView(e('cap_reached'), false).urgent, false);
});

// 재검토 I-1: 켜기가 409 spend_unknown이면 적용 당일엔 켤 수 없고, 다음 날(KST) 아래에서부터(소재 → 키워드 → 그룹 → 캠페인) 켜라고 안내한다.
test('launch spend_unknown explains apply-day and bottom-up next-day launch; pause spend_unknown stays urgent', () => {
  const e = { code: 'spend_unknown', message: '오늘 광고비를 확인하지 못했습니다. …', status: 409 };
  const v = s.lockErrorView(e, false);
  assert.equal(v.message, f.failCodeMessage('launch_spend_unknown'), '기존 failCode → 문구 표(FIXED_FAIL)에서 온다');
  for (const part of ['적용한 날', '다음 날', '소재 → 키워드 → 그룹 → 캠페인']) assert.ok(v.message.includes(part), part);
  assert.deepEqual([v.urgent, v.reload], [false, true]);
  assert.ok(s.lockErrorView(e, true).message.includes(URGENT), '끄기 요청이면 여전히 urgent 직접 끄기');
  assert.equal(f.errorView(e).message, e.message, '켜기 밖(적용 등)의 spend_unknown은 기존 그대로');
});

test('disconnecting account: warning while in progress, urgent with a retry hint once stuck; nothing otherwise', () => {
  const acc = (status, disconnectStuck = false) => ({ status, disconnectStuck });
  assert.equal(s.disconnectingView(acc('active')), null);
  const young = s.disconnectingView(acc('disconnecting'));
  assert.equal(young.urgent, false);
  const stuck = s.disconnectingView(acc('disconnecting', true));
  assert.equal(stuck.urgent, true);
  assert.ok(stuck.message.includes('해제 다시 시도'));
});
