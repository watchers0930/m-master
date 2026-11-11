/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// 광고 화면 표시 문구(lib/api/ads-format.ts, Task 12) — failCode·오류 코드 → 한국어, 금액·스냅샷 나이·전환 비용, 잠금·검수 표시, 씨앗 입력.
// 문구는 Task 5~11 판정(task-12-carry.md)에서 그대로 가져온다.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const f = require('../ads-format.ts');

test('failCode → Korean (carried rulings)', () => {
  assert.equal(f.failCodeMessage(null), null);
  assert.ok(f.failCodeMessage('uncertain:campaign.create').includes('네이버에 생성됐는지 확인되지 않음 — 네이버 화면 확인 후 새 제안으로 진행'));
  assert.ok(f.failCodeMessage('pause_failed:adgroup.create:g0').includes('즉시 네이버 화면에서 직접 꺼 주세요'));
  assert.ok(f.failCodeMessage('drift:userLock').includes('userLock'));
  assert.ok(f.failCodeMessage('target_active').includes('먼저 끈'));
  assert.ok(f.failCodeMessage('ads_paused').includes('비상 정지'));
  assert.ok(f.failCodeMessage('lint:forbidden-keyword').includes('forbidden-keyword'));
  assert.ok(f.failCodeMessage('rejected:3909').includes('3909'));
  assert.ok(f.failCodeMessage('ambiguous:keyword.create').includes('네이버 화면'));
  const messages = ['target_active', 'cap_reached', 'spend_unknown', 'guard_locked', 'ads_paused', 'ads_not_connected', 'target_adgroup_deleted', 'internal_error']
    .map((c) => f.failCodeMessage(c));
  assert.equal(new Set(messages).size, messages.length, '코드마다 다른 안내');
  for (const m of messages) assert.equal(m.includes('적용 실패('), false, '알려진 코드는 일반 문구가 아니다');
  assert.ok(f.failCodeMessage('mystery_code').includes('mystery_code'), '모르는 코드는 코드를 보여 준다');
  assert.equal(f.isUrgentFailCode('pause_failed:x'), true);
  assert.equal(f.isUrgentFailCode('uncertain:x'), true);
  assert.equal(f.isUrgentFailCode('cap_reached'), false);
});

test('API error → message: urgent pause, budget, version conflict, disconnect abort', () => {
  const e = (code, message = '서버 문구', status = 409, details = {}) => ({ code, message, status, details });
  const pause = f.errorView(e('pause_unconfirmed', '네이버가 끄기 요청을 받았지만…', 502));
  assert.ok(pause.message.includes('네이버 화면에서 지금 바로 직접 꺼 주세요'));
  assert.equal(pause.urgent, true);
  assert.equal(f.errorView(e('budget_exceeded', 'x', 429)).message, '월 예산 한도 초과. 설정에서 한도를 조정하세요.');
  assert.ok(f.errorView(e('version_conflict')).message.includes('최신 내용으로 다시 불러왔습니다'));
  assert.equal(f.errorView(e('version_conflict')).reload, true);
  const abort = f.errorView(e('disconnect_incomplete', 'x', 502, { unconfirmedCampaigns: 2 }));
  assert.ok(abort.message.includes('키는 그대로') && abort.message.includes('2'));
  assert.ok(abort.message.includes('꺼진 것을 확인하지 못'));
  assert.equal(f.errorView(e('drift', '네이버 설정이 다릅니다.', 409, { field: 'aiAdsOptIn' })).message.includes('aiAdsOptIn'), true);
  assert.ok(f.errorView(e('ads_invariant', '광고 상한 규칙을 지키지 못하는 요청입니다.', 422, { field: 'groups.0.bidAmt' })).message.includes('groups.0.bidAmt'), '입찰 위치를 알려 준다');
  assert.equal(f.errorView(e('ads_key_rejected', '네이버가 키를 거부했습니다.', 400)).message, '네이버가 키를 거부했습니다.', '그 밖은 서버 문구');
  assert.equal(f.errorView(new Error('boom')).message, '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.');
});

test('money, snapshot age, cost per signup', () => {
  assert.equal(f.formatKrw(1234567), '1,234,567원');
  assert.equal(f.formatKrw(0), '0원');
  assert.equal(f.formatKrw(null), '확인 못 함');
  assert.equal(f.snapshotAgeLabel(null), '감시 기록 없음');
  assert.equal(f.snapshotAgeLabel(0), '방금 전 기준');
  assert.equal(f.snapshotAgeLabel(12), '12분 전 기준');
  assert.equal(f.snapshotAgeLabel(125), '2시간 5분 전 기준');
  assert.equal(f.snapshotAgeLabel(60 * 26), '1일 2시간 전 기준');
  assert.equal(f.costPerSignup(5000, 0), '전환 추적 준비 전(4-2)', '전환 0이면 0원·∞를 쓰지 않는다');
  assert.equal(f.costPerSignup(10000, 3), '3,333원');
  assert.equal(f.capPercent(45000, 100000), 45);
  assert.equal(f.capPercent(null, 100000), null);
  assert.equal(f.capPercent(150000, 100000), 150);
  assert.equal(f.ctr(10, 0), '—');
  assert.equal(f.ctr(3, 200), '1.50%');
});

test('lock and inspection labels', () => {
  assert.equal(f.lockLabel(false, null).text, '켜짐');
  assert.ok(f.lockLabel(true, 'owner').text.includes('대장'));
  assert.ok(f.lockLabel(true, 'guard').text.includes('감시'));
  assert.ok(f.lockLabel(true, 'pending_launch').text.includes('켜기 전'));
  assert.equal(f.lockLabel(true, null).text, '꺼짐');
  assert.equal(f.inspectLabel('APPROVED'), '승인');
  assert.equal(f.inspectLabel('ELIGIBLE'), '노출 가능');
  assert.equal(f.inspectLabel('UNDER_REVIEW'), '검수 중');
  assert.equal(f.inspectLabel('REJECTED'), '반려');
  assert.equal(f.inspectLabel(null), '—');
  assert.equal(f.inspectLabel('SOMETHING'), 'SOMETHING');
  assert.equal(f.channelNote({ selectable: false, pcInspectStatus: 'UNDER_REVIEW', mobileInspectStatus: 'APPROVED' }), '검수 중(PC 검수 중 · 모바일 승인) — 승인 후 선택할 수 있습니다');
  assert.equal(f.channelNote({ selectable: true, pcInspectStatus: 'APPROVED', mobileInspectStatus: 'ELIGIBLE' }), null);
});

test('manual seeds: split, trim, dedupe, ≤25 items, ≤40 chars', () => {
  assert.deepEqual(f.parseSeeds(' 전세사기 , 깡통전세\n전세사기\n\n등기부 '), { seeds: ['전세사기', '깡통전세', '등기부'], error: null });
  assert.deepEqual(f.parseSeeds(''), { seeds: [], error: null });
  const many = Array.from({ length: 26 }, (_, i) => `k${i}`).join(',');
  assert.equal(f.parseSeeds(many).error, '씨앗 키워드는 25개 이하입니다.');
  assert.equal(f.parseSeeds('가'.repeat(41)).error, '씨앗 키워드는 40자 이하입니다.');
  assert.equal(f.parseSeeds('가'.repeat(40)).error, null);
  assert.equal(f.MAX_SEEDS, 25);
  assert.equal(f.MAX_SEED_LENGTH, 40);
});

test('proposal status labels and lint issue lookup', () => {
  for (const s of ['draft', 'pending_review', 'approved', 'rejected', 'applying', 'applied', 'apply_failed']) assert.ok(f.proposalStatusLabel(s).length > 0);
  assert.equal(f.proposalStatusLabel('pending_review'), '검토 대기');
  const issues = [
    { group: 0, target: 'keyword', index: 1, rule: 'r1', field: 'keyword', message: 'm1' },
    { group: 0, target: 'creative', index: 0, rule: 'r2', field: 'headline', message: 'm2' },
    { group: 1, target: 'creative', index: 0, rule: 'r3', field: 'description', message: 'm3' },
  ];
  assert.deepEqual(f.issuesFor(issues, 0, 'keyword', 1).map((i) => i.rule), ['r1']);
  assert.deepEqual(f.issuesFor(issues, 0, 'creative', 0, 'headline').map((i) => i.rule), ['r2']);
  assert.deepEqual(f.issuesFor(issues, 0, 'creative', 0, 'description'), []);
  assert.deepEqual(f.issuesFor([], 0, 'keyword', 0), []);
});

test('B1: bidRangeLabel shows the server range with thousands separators; unknown range is not shown as a number', () => {
  assert.equal(f.bidRangeLabel({ min: 70, max: 1000 }), '허용 70~1,000원');
  assert.equal(f.bidRangeLabel({ min: 70, max: 70 }), '허용 70~70원');
  assert.equal(f.bidRangeLabel(null), '허용 범위 확인 못 함');
});
