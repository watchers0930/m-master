// scripts/consulting/diagnose-rejection.ts — 저장된 리포트 입력으로 운영 생성 절차(strict 도구 → 판정 → 검증 사유 1회 교정)를 재현한다.
// 운영과 같은 모듈(prompt.ts·judge.ts)을 그대로 쓴다. DB에는 쓰지 않는다(리포트 읽기만). 회당 LLM 1~2회 호출 비용이 든다.
// 모델 출력 본문은 출력하지 않고 판정 사유만 보여준다.
// 사용: npx tsx scripts/consulting/diagnose-rejection.ts <reportId> [반복 횟수=1]
import { config } from 'dotenv'; config({ path: '.env.local' });
(async () => {
  const [reportId, times = '1'] = process.argv.slice(2);
  if (!reportId) { console.error('reportId 가 필요합니다.'); process.exit(1); }
  const { prisma } = await import('@/lib/prisma');
  const { parseConsultingSnapshot } = await import('@/schemas/consulting');
  const { VERSIONS, MAX_OUTPUT_TOKENS, MAX_REPAIR_CALLS, strategyTool, buildPrompt, repairPrompt } = await import('@/lib/consulting/prompt');
  const { judgeStrategy } = await import('@/lib/consulting/judge');
  const { getClient } = await import('@/lib/claude/chat');
  const row = await prisma.consultingReport.findUnique({ where: { id: reportId }, select: { inputSnapshot: true, schemaVersion: true, status: true, failCode: true } });
  await prisma.$disconnect();
  if (!row) { console.error('리포트를 찾지 못했습니다.'); process.exit(1); }
  console.log('리포트 상태:', row.status, row.failCode, '| 스키마:', row.schemaVersion, '| 절차:', VERSIONS.promptVersion);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the frozen snapshot is validated by parseConsultingSnapshot.
  const snapshot = parseConsultingSnapshot(row.inputSnapshot, row.schemaVersion) as any;
  const messages = buildPrompt(snapshot);
  const ask = (body: Parameters<typeof repairPrompt>[0] | ReturnType<typeof repairPrompt>) => getClient().chat.completions.create({ model: VERSIONS.model,
    messages: body, max_tokens: MAX_OUTPUT_TOKENS, tools: [strategyTool], parallel_tool_calls: false,
    tool_choice: { type: 'function', function: { name: 'submit_strategy' } } }, { maxRetries: 0, timeout: 60000 });
  let passed = 0;
  for (let run = 1; run <= Number(times); run++) {
    let verdict = judgeStrategy(await ask(messages), snapshot, 'diagnose');
    let repairs = 0;
    while (!verdict.strategy && verdict.call && repairs < MAX_REPAIR_CALLS) {
      repairs++; verdict = judgeStrategy(await ask(repairPrompt(messages, verdict.call, verdict.reason)), snapshot, 'diagnose');
    }
    if (verdict.strategy) passed++;
    console.log(`[${run}회] ${verdict.strategy ? '통과' : '실패'} (교정 ${repairs}회)${verdict.strategy ? '' : ' — ' + verdict.reason}`);
  }
  console.log(`결과: ${passed}/${times} 통과`);
})();
