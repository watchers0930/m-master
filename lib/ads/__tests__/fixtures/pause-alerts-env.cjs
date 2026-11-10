/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test helper. */
/* global require, module, process */
// 안전 끄기 실패 알림 테스트 공용(Task 9 판정 round 2): 파일마다 새 환경(계정 1개) + 같은 날 ads.drift를 먼저 심는다.
// 알림 중복 제거는 (계정, 유형, KST 날짜)라 경로마다 별도 프로세스·계정이 필요하다(한 프로세스에서 환경을 두 번 만들 수 없음).
const { setupApplyEnv } = require('./apply-env.cjs');
const { json } = require('./fake-naver.cjs');

async function withPauseAlertEnv(packageDir, fn) {
  const a = await setupApplyEnv(packageDir);
  try {
    const { queueAlert } = require('../../alerts.ts');
    await queueAlert(a.accountId, 'ads.drift', { seeded: 'same-day drift' }); // 같은 날 다른 알림이 먼저 있다 — 지우지 않는다
    await fn(a);
  } finally {
    delete process.env.ADS_EXECUTION_ENABLED;
    await a.env.close();
  }
}
const pauseAlerts = (client) => client.adAlert.findMany({ where: { type: 'ads.pause_failed' } });
const failPut = (re, status = 500) => (c) => (c.method === 'PUT' && re.test(c.path) && c.body?.userLock === true ? json(status, {}) : undefined);

module.exports = { withPauseAlertEnv, pauseAlerts, failPut, json };
