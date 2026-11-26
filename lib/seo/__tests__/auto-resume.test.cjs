/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require */
// SEO 진단 자동 이어가기 규칙(lib/seo/auto-resume.ts) — 순수 함수.
// - 이어가기: 진행 중(pending)이고 남은 작업(pending·claimed·submitted)이 있을 때만. 부분 완료·완료·실패·남은 작업 없음은 멈춤.
// - 대기: 진행이 있으면 3초, 없으면 두 배(최대 20초). 진행 판정은 상태·비용·작업별 상태 서명.
require('../../visibility/__tests__/register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const a = require('../auto-resume.ts');

const t = (operation, status, itemKey = '-') => ({ operation, status, itemKey });
const audit = (status, tasks, costKrw = 0) => ({ status, tasks, costKrw });

test('continue only while pending with remaining active work', () => {
  assert.equal(a.shouldContinue(audit('pending', [t('serp_google', 'submitted')])), true);
  assert.equal(a.shouldContinue(audit('pending', [t('serp_google', 'pending')])), true);
  assert.equal(a.shouldContinue(audit('pending', [t('serp_google', 'completed'), t('kw_ads', 'skipped')])), false, '남은 작업 없음');
  assert.equal(a.shouldContinue(audit('partial', [t('serp_google', 'pending')])), false, '부분 완료는 자동으로 다시 돌지 않는다');
  assert.equal(a.shouldContinue(audit('completed', [])), false);
  assert.equal(a.shouldContinue(audit('failed', [t('x', 'uncertain')])), false);
});

test('progress signature changes on any task status, cost, or audit status change; order-insensitive', () => {
  const base = audit('pending', [t('a', 'pending'), t('b', 'submitted')], 10);
  assert.equal(a.progressSignature(base), a.progressSignature(audit('pending', [t('b', 'submitted'), t('a', 'pending')], 10)));
  assert.notEqual(a.progressSignature(base), a.progressSignature(audit('pending', [t('a', 'submitted'), t('b', 'submitted')], 10)));
  assert.notEqual(a.progressSignature(base), a.progressSignature(audit('pending', [t('a', 'pending'), t('b', 'submitted')], 11)));
  assert.notEqual(a.progressSignature(base), a.progressSignature(audit('completed', base.tasks, 10)));
});

test('delay: 3s after progress, doubling up to 20s without progress', () => {
  assert.equal(a.nextDelay(true, 20000), 3000);
  assert.deepEqual([3000, 6000, 12000, 20000].map((d) => a.nextDelay(false, d)), [6000, 12000, 20000, 20000]);
  assert.equal(a.nextDelay(false, 0), 3000);
  assert.equal(a.AUTO_RESUME_LIMIT_MS, 15 * 60000);
});
