// scripts/db/pipeline-readiness.ts — 읽기 전용: 자동 파이프라인(전략→토픽→글) 실행 조건 점검(lib/pipeline/owners.ts 와 같은 조건)
// 사용: npx tsx scripts/db/pipeline-readiness.ts [ownerId]   (쓰기 없음, 비밀값 없음)
import { config } from 'dotenv'; config({ path: '.env.local' });
(async () => {
  const { prisma } = await import('@/lib/prisma');
  if (process.argv[2] === '--all') {
    // 권한 조건 변경 전 영향 범위: 계정별 요금제·구독 상태·자동화 도메인
    const users = await prisma.user.findMany({ select: { id: true, plan: true,
      subscriptions: { select: { status: true } }, settings: { select: { automationDomainId: true }, take: 1 } }, take: 200 });
    console.table(users.map(u => ({ owner: u.id, plan: u.plan, subs: u.subscriptions.map(s => s.status).join(',') || '(없음)',
      automationDomain: u.settings[0]?.automationDomainId ? '지정' : '-' })));
    await prisma.$disconnect(); return;
  }
  const ownerId = process.argv[2] ?? 'cm_admin_001';
  const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { plan: true,
    subscriptions: { select: { status: true, currentPeriodEnd: true }, take: 5 },
    settings: { select: { automationDomainId: true }, take: 1 } } });
  console.log('plan:', user?.plan, '| subscriptions:', JSON.stringify(user?.subscriptions ?? []), '| automationDomainId:', user?.settings[0]?.automationDomainId ?? null);
  const reports = await prisma.consultingReport.findMany({ where: { ownerId }, select: { id: true, domainId: true, status: true, generatedAt: true },
    orderBy: { generatedAt: 'desc' }, take: 3 });
  console.log('최근 컨설팅 리포트:', JSON.stringify(reports));
  const runs = await prisma.pipelineRun.findMany({ where: { ownerId }, select: { kind: true, periodKey: true, status: true, attempts: true, errorCode: true },
    orderBy: { id: 'desc' }, take: 10 });
  console.log('pipeline_runs:', JSON.stringify(runs));
  const plans = await prisma.contentPlan.findMany({ where: { ownerId }, select: { id: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 3 });
  console.log('최근 콘텐츠 계획:', JSON.stringify(plans));
  await prisma.$disconnect();
})();
