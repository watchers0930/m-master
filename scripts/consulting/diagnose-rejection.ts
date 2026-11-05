// scripts/consulting/diagnose-rejection.ts — llm_failed 리포트 원인 재현(운영 생성과 같은 입력·프롬프트·도구·검증기).
// DB에는 쓰지 않는다(리포트 읽기만). LLM 1회 호출 비용이 든다. 모델 출력 본문은 출력하지 않고 검증 사유만 보여준다.
// 사용: npx tsx scripts/consulting/diagnose-rejection.ts <reportId>
import { config } from 'dotenv'; config({ path: '.env.local' });
(async () => {
  const reportId = process.argv[2];
  if (!reportId) { console.error('reportId 가 필요합니다.'); process.exit(1); }
  const { prisma } = await import('@/lib/prisma');
  const { parseConsultingSnapshot } = await import('@/schemas/consulting');
  const { VERSIONS, MAX_OUTPUT_TOKENS, strategyTool, buildPrompt } = await import('@/lib/consulting/prompt');
  const { validateStrategy } = await import('@/lib/consulting/validate');
  const { getClient } = await import('@/lib/claude/chat');
  const row = await prisma.consultingReport.findUnique({ where: { id: reportId }, select: { inputSnapshot: true, schemaVersion: true, status: true, failCode: true } });
  await prisma.$disconnect();
  if (!row) { console.error('리포트를 찾지 못했습니다.'); process.exit(1); }
  console.log('리포트 상태:', row.status, row.failCode, '| 스키마:', row.schemaVersion);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the frozen snapshot is validated by parseConsultingSnapshot.
  const snapshot = parseConsultingSnapshot(row.inputSnapshot, row.schemaVersion) as any;
  const response = await getClient().chat.completions.create({ model: VERSIONS.model, messages: buildPrompt(snapshot),
    max_tokens: MAX_OUTPUT_TOKENS, tools: [strategyTool], parallel_tool_calls: false,
    tool_choice: { type: 'function', function: { name: 'submit_strategy' } } }, { maxRetries: 0, timeout: 60000 });
  const choice = response.choices[0], calls = choice?.message.tool_calls;
  console.log('finish_reason:', choice?.finish_reason, '| tool_calls:', calls?.length ?? 0, '| 토큰:', response.usage?.prompt_tokens, '/', response.usage?.completion_tokens);
  if (!calls?.[0] || calls[0].type !== 'function') return;
  try {
    validateStrategy(JSON.parse(calls[0].function.arguments), snapshot.llmInput ?? snapshot);
    console.log('검증 결과: 통과 (이번 호출은 성공 — 실패가 확률적일 가능성)');
  } catch (error) {
    const issues = (error as { issues?: { path?: unknown[]; code?: string; message?: string }[] }).issues;
    if (issues) for (const i of issues.slice(0, 10)) console.log('검증 실패(zod):', i.code, '@', (i.path ?? []).join('.'), '—', String(i.message ?? '').slice(0, 160));
    else console.log('검증 실패:', String((error as Error)?.message ?? error).slice(0, 200));
  }
})();
