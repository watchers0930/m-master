/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, __dirname */
// 안전 표시 배선(최종 판정 B1~B5) — 렌더 환경이 없어 소스로 확인한다(문구 규칙 자체는 ads-safety.test.cjs가 고정).
// - 대시보드 맨 위: 안전 경보 배너(alerts+snapshot) + 잠금 실패 페이지 배너. 제안 상세도 같은 페이지 배너.
// - 끄기·켜기 실패는 표 셀이 아니라 페이지 배너로(lockErrorView), 배지는 pauseUnconfirmed·경보 꼬리표.
// - 해제 중 계정: 경고 + 멈추면 '해제 다시 시도'(기존 DELETE). 키가 든 mutation은 gcTime 0 + 끝나면 reset.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
const C = (f) => fs.readFileSync(path.join(ROOT, 'app/(dashboard)/ads/components', f), 'utf8');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('dashboard and proposal detail render page-level safety and lock banners at the top', () => {
  const dash = C('AdsDashboard.tsx');
  assert.match(dash, /<LockNoticesProvider>/);
  assert.match(dash, /<SafetyBanner alerts=\{overview\.data\.alerts\} snapshot=\{overview\.data\.snapshot\} \/>/);
  assert.ok(dash.indexOf('<LockNoticeBanner') < dash.indexOf('<StatusCards'), '잠금 배너가 표보다 위');
  assert.ok(dash.indexOf('<SafetyBanner') < dash.indexOf('<StatusCards'), '경보 배너가 상태 카드보다 위');
  assert.match(dash, /disconnectingView\(selected\)/);
  const detail = C('ProposalDetail.tsx');
  assert.match(detail, /<LockNoticesProvider>/);
  assert.match(detail, /<LockNoticeBanner \/>/);
  assert.match(C('SafetyBanner.tsx'), /safetyNotices\(alerts, snapshot\)/);
});

test('lock failures go to the page banner via lockErrorView, not only into the table cell', () => {
  const btn = C('LockButton.tsx');
  assert.match(btn, /lockErrorView\(e, !turnOn\)/);
  assert.match(btn, /notices\.push\(/);
  const banner = C('LockNotices.tsx');
  assert.match(banner, /scrollIntoView/);
  assert.match(banner, /\.focus\(/);
});

test('badges show unconfirmed pauses and per-entity alerts in both tables', () => {
  for (const f of ['CampaignTable.tsx', 'ProposalEntities.tsx']) {
    const src = C(f);
    assert.match(src, /pauseUnconfirmed=\{\w+\.pauseUnconfirmed\}/, f);
    assert.match(src, /alertBadges\(/, f);
  }
  assert.match(C('ui.tsx'), /lockLabel\(userLock, lockedBy, pauseUnconfirmed\)/);
});

test('disconnecting account card shows the warning and a retry that calls the existing DELETE once stuck', () => {
  const card = C('AccountCard.tsx');
  assert.match(card, /disconnectingView\(account\)/);
  assert.match(card, /account\.disconnectStuck && \(/);
  assert.match(card, /해제 다시 시도/);
  assert.match(card, /disconnect\.mutate\(account\.id/);
});

test('API keys do not linger in react-query mutation state', () => {
  const hook = read('hooks/useAdsAccounts.ts');
  const block = (name) => hook.slice(hook.indexOf(`const ${name} = useMutation(`), hook.indexOf('});', hook.indexOf(`const ${name} = useMutation(`)));
  for (const name of ['connect', 'replaceKeys']) assert.match(block(name), /gcTime: 0/, name);
  assert.doesNotMatch(hook, /캐시·상태에 남기지 않는다/, '사실과 다른 머리말 제거');
  assert.match(C('ConnectForm.tsx'), /onSettled: \(\) => connect\.reset\(\)/);
  assert.match(C('AccountCard.tsx'), /onSettled: \(\) => replaceKeys\.reset\(\)/);
});

test('B1: every proposal bid input shows the server bid range and caps the input with max; the client never recomputes the ceiling', () => {
  const editor = C('ProposalGroupEditor.tsx');
  const inputs = (editor.match(/<input type="number"[\s\S]*?\/>/g) ?? []).filter((tag) => tag.includes('bidAmt'));
  assert.equal(inputs.length, 2, '그룹 기본 입찰 + 키워드 입찰');
  for (const tag of inputs) {
    assert.match(tag, /min=\{bidRange\?\.min \?\? 70\}/, tag);
    assert.match(tag, /max=\{bidRange\?\.max\}/, tag);
  }
  assert.equal((editor.match(/<BidRangeHint range=\{bidRange\} \/>/g) ?? []).length, 2, '두 입력칸 옆에 같은 범위 안내');
  assert.match(C('ProposalDetail.tsx'), /bidRange=\{proposal\.bidRange\}/);
  for (const f of fs.readdirSync(path.join(ROOT, 'app/(dashboard)/ads/components')))
    assert.doesNotMatch(C(f), /dailyCapKrw\s*\/|MIN_DAILY_CLICKS|proposalBidCeiling/, `${f}: 천장 공식은 서버(invariants.ts) 한 곳`);
});
