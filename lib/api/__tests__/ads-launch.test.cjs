/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 제안 전체 켜기(lib/api/ads-launch.ts) — 순수 함수.
// - 순서: 소재 → 키워드 → 광고그룹 → 캠페인, 이 제안의 꺼진 항목만(켜진 것·다른 제안 제외). 개요가 잘렸으면 truncated.
// - 검수 미통과(not_inspected) 키워드·소재는 건너뜀, 그 밖의 실패는 멈추고 이번에 켠 것만 역순으로 다시 끈다.
// - 다시 끄지 못한 항목이 있거나 실패 자체가 urgent면 결과도 urgent.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const l = require('../ads-launch.ts');

const row = (id, extra = {}) => ({ id, naverId: `n-${id}`, parentNaverId: null, name: id, proposalId: 'p1', userLock: true, lockedBy: 'pending_launch', lockVersion: 0, lockedAt: null, inspectStatus: 'APPROVED', pauseUnconfirmed: false, ...extra });
const overview = (extra = {}) => ({
  campaigns: [row('c1', { userLock: false, lockedBy: null, lockVersion: 1 })],
  groups: [row('g1'), row('g2', { proposalId: 'other' })],
  keywords: [row('k1'), row('k2', { lockedBy: 'owner', lockVersion: 3 })],
  ads: [row('a1')],
  truncated: { campaigns: false, groups: false, keywords: false, ads: false },
  ...extra,
});
const err = (code, status = 409) => Object.assign(new Error(code), { code, status, details: {} }); // 서버 확정 거절(AdsApiError 모양)

test('plan: children first, only this proposal, already-on campaign excluded, owner-locked included with its version', () => {
  const plan = l.planLaunch(overview(), 'p1');
  assert.deepEqual(plan.items.map((x) => `${x.type}:${x.id}:${x.lockVersion}`), ['ad:a1:0', 'keyword:k1:0', 'keyword:k2:3', 'adgroup:g1:0']);
  assert.equal(plan.truncated, false);
  assert.equal(l.planLaunch(overview({ truncated: { campaigns: false, groups: false, keywords: true, ads: false } }), 'p1').truncated, true);
});

test('run: all succeed in order, progress reported; not_inspected ad/keyword skipped and does not stop', async () => {
  const calls = [];
  const progress = [];
  const lock = async (type, id, locked, v) => {
    calls.push(`${locked ? 'off' : 'on'}:${id}:${v}`);
    if (id === 'k1') throw err('not_inspected');
    return { type, id, naverId: `n-${id}`, userLock: locked, lockedBy: null, lockVersion: v + 1 };
  };
  const r = await l.runLaunch(l.planLaunch(overview(), 'p1').items, lock, (n) => progress.push(n));
  assert.deepEqual(calls, ['on:a1:0', 'on:k1:0', 'on:k2:3', 'on:g1:0']);
  assert.deepEqual(progress, [1, 2, 3, 4]);
  assert.deepEqual(r.turnedOn.map((x) => x.id), ['a1', 'k2', 'g1']);
  assert.deepEqual(r.skipped.map((x) => x.id), ['k1']);
  assert.equal(r.failure, null);
  const v = l.launchResultView(r);
  assert.equal(v.urgent, false);
  assert.ok(v.message.includes('3개를 켰습니다') && v.message.includes("키워드 'k1'"), v.message);
});

test('run: not_inspected on an adgroup is a failure (only keyword/ad skip)', async () => {
  const items = [{ type: 'adgroup', id: 'g1', naverId: 'n', name: 'g1', lockVersion: 0 }];
  const r = await l.runLaunch(items, async () => { throw err('not_inspected'); });
  assert.equal(r.failure.item.id, 'g1');
  assert.equal(r.skipped.length, 0);
});

test('run: failure stops, rolls back only what this run turned on (reverse order); later items never sent', async () => {
  const calls = [];
  const lock = async (type, id, locked, v) => {
    calls.push(`${locked ? 'off' : 'on'}:${id}`);
    if (!locked && id === 'k2') throw err('cap_reached');
    return { type, id, naverId: id, userLock: locked, lockedBy: locked ? 'owner' : null, lockVersion: v + 1 };
  };
  const r = await l.runLaunch(l.planLaunch(overview(), 'p1').items, lock);
  assert.deepEqual(calls, ['on:a1', 'on:k1', 'on:k2', 'off:k1', 'off:a1']);
  assert.equal(r.failure.item.id, 'k2');
  assert.deepEqual(r.rolledBack.map((x) => x.id), ['k1', 'a1']);
  const v = l.launchResultView(r, { message: '상한 도달', urgent: false });
  assert.equal(v.urgent, false);
  assert.ok(v.message.includes("키워드 'k2'") && v.message.includes('2개는 다시 껐습니다') && v.message.includes('상한 도달'), v.message);
});

test('run: rollback failure is urgent and names the item; resume that returns userLock=true counts as failure', async () => {
  const lock = async (type, id, locked) => {
    if (locked && id === 'a1') throw err('pause_unconfirmed');
    if (!locked && id === 'k1') return { type, id, naverId: id, userLock: true, lockedBy: null, lockVersion: 1 };
    return { type, id, naverId: id, userLock: locked, lockedBy: null, lockVersion: 1 };
  };
  const r = await l.runLaunch(l.planLaunch(overview(), 'p1').items, lock);
  assert.equal(r.failure.item.id, 'k1');
  assert.equal(r.failure.error.code, 'not_resumed');
  assert.deepEqual(r.rollbackFailed.map((x) => x.id), ['a1']);
  const v = l.launchResultView(r, { message: 'x', urgent: false });
  assert.equal(v.urgent, true);
  assert.ok(v.message.includes("소재 'a1'") && v.message.includes('직접 꺼'), v.message);
});

test('result view: a failed item that is itself urgent (unknown state, re-pause failed) stays urgent even without rollback', () => {
  const r = { turnedOn: [], skipped: [], failure: { item: { type: 'campaign', id: 'c', naverId: 'c', name: 'c', lockVersion: 0 }, error: err('ads_uncertain'), unknownState: true }, rolledBack: [], rollbackFailed: [], rollbackSkipped: [] };
  assert.equal(l.launchResultView(r, { message: '직접 꺼 주세요', urgent: true }).urgent, true);
});

// codex 반례(2026-11-26): 응답 유실 = 켜졌는지 모름 → 그 항목도 끈다. 다른 탭이 그 사이 바꾼 항목은 되돌리지 않는다. 현재 상태를 못 읽으면 다 끈다.
const items3 = [
  { type: 'ad', id: 'a1', naverId: 'n', name: 'a1', lockVersion: 0 },
  { type: 'keyword', id: 'k1', naverId: 'n', name: 'k1', lockVersion: 0 },
  { type: 'adgroup', id: 'g1', naverId: 'n', name: 'g1', lockVersion: 0 },
];
const ok = (type, id, locked, v) => ({ type, id, naverId: id, userLock: locked, lockedBy: null, lockVersion: v + 1 });

test('unknown state (network loss on resume) → the failed item is paused too; 5xx with details.paused=true is not', async () => {
  const calls = [];
  const lock = async (type, id, locked, v) => {
    calls.push(`${locked ? 'off' : 'on'}:${id}`);
    if (!locked && id === 'g1') throw Object.assign(new Error('net'), { code: 'network', status: 0 });
    return ok(type, id, locked, v);
  };
  const r = await l.runLaunch(items3, lock);
  assert.equal(r.failure.unknownState, true);
  assert.deepEqual(calls, ['on:a1', 'on:k1', 'on:g1', 'off:g1', 'off:k1', 'off:a1']);
  assert.equal(l.isUnknownState({ code: 'ads_uncertain', status: 502, details: { paused: true } }), false);
  assert.equal(l.isUnknownState({ code: 'ads_uncertain', status: 502, details: { paused: false } }), true);
  assert.equal(l.isUnknownState({ code: 'cap_reached', status: 409, details: {} }), false);
});

test('rollback skips items another tab changed since this run turned them on; unreadable current state → pause all', async () => {
  const calls = [];
  const lock = async (type, id, locked, v) => {
    calls.push(`${locked ? 'off' : 'on'}:${id}`);
    if (!locked && id === 'g1') throw Object.assign(new Error('cap'), { code: 'cap_reached', status: 409 });
    return ok(type, id, locked, v);
  };
  // a1은 내가 켠 뒤 버전 1 → 다른 탭이 끄고 다시 켜 버전 3. k1은 그대로 1
  const r = await l.runLaunch(items3, lock, undefined, async () => new Map([['ad:a1', 3], ['keyword:k1', 1]]));
  assert.deepEqual(calls, ['on:a1', 'on:k1', 'on:g1', 'off:k1']);
  assert.deepEqual(r.rollbackSkipped.map((x) => x.id), ['a1']);
  assert.ok(l.launchResultView(r, { message: 'x', urgent: false }).message.includes("소재 'a1'은(는) 그 사이 다른 곳에서 바뀌어"));
  calls.length = 0;
  const r2 = await l.runLaunch(items3, lock, undefined, async () => { throw new Error('offline'); });
  assert.deepEqual(calls, ['on:a1', 'on:k1', 'on:g1', 'off:k1', 'off:a1']);
  assert.equal(r2.rollbackSkipped.length, 0);
});

test('codex 2nd round: a 200 whose body was lost (unknown/200) is unknown state → paused; 4xx and server re-paused are known', async () => {
  assert.equal(l.isUnknownState({ code: 'unknown', status: 200, details: {} }), true, '본문 유실 200');
  assert.equal(l.isUnknownState({ code: 'not_resumed' }), true, '켜짐 미확인');
  assert.equal(l.isUnknownState({ code: 'drift', status: 409, details: {} }), false);
  assert.equal(l.isUnknownState({ code: 'resume_race', status: 409, details: { paused: true } }), false);
  const calls = [];
  const lock = async (type, id, locked, v) => {
    calls.push(`${locked ? 'off' : 'on'}:${id}`);
    if (!locked && id === 'g1') throw Object.assign(new Error('body lost'), { code: 'unknown', status: 200, details: {} });
    return { type, id, naverId: id, userLock: locked, lockedBy: null, lockVersion: v + 1 };
  };
  const r = await l.runLaunch([{ type: 'adgroup', id: 'g1', naverId: 'n', name: 'g1', lockVersion: 0 }], lock);
  assert.deepEqual(calls, ['on:g1', 'off:g1']);
  assert.deepEqual(r.rolledBack.map((x) => x.id), ['g1']);
});
