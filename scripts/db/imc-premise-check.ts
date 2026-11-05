// scripts/db/imc-premise-check.ts — 읽기 전용: 계정별 브랜드 설정 채움 여부·채널 프롬프트 템플릿·콘텐츠 분포(IMC 메시지 통합 착수 전 전제 확인)
// 사용: npx tsx scripts/db/imc-premise-check.ts   (비밀값 없음, 쓰기 없음)
import { config } from 'dotenv'; config({ path: '.env.local' });
(async () => {
  const { prisma } = await import('@/lib/prisma');
  const settings = await prisma.setting.findMany({ select: { ownerId: true, brandGuide: true, promptTemplates: true } });
  for (const s of settings) {
    const bg = (s.brandGuide ?? {}) as Record<string, unknown>;
    const filled = Object.entries(bg).filter(([, v]) => (Array.isArray(v) ? v.length : v)).map(([k]) => k);
    const pt = s.promptTemplates && typeof s.promptTemplates === 'object' ? Object.entries(s.promptTemplates as Record<string, unknown>).filter(([, v]) => v).map(([k]) => k) : [];
    console.log('owner', s.ownerId, '| brandGuide 채워진 키:', filled.join(',') || '(없음)', '| promptTemplates 채널:', pt.join(',') || '(없음)');
    if (s.ownerId === 'cm_admin_001') console.log('   company_name=', bg.company_name, '| tone=', bg.tone, '| cta=', String(bg.cta_message ?? '').slice(0, 60));
  }
  const rows = await prisma.content.groupBy({ by: ['ownerId', 'channel'], _count: true, _max: { createdAt: true } });
  console.table(rows.map(r => ({ owner: r.ownerId, channel: r.channel, n: r._count, last: r._max.createdAt?.toISOString().slice(0, 10) })));
  await prisma.$disconnect();
})();
