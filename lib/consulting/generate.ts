import { collectGa4 } from "./ga4-collect";
import { completedRange } from "./input";
import { freezeSnapshot } from "./freeze";
import { isDefinitiveRejection } from "./rejection";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { consultingCreateSchema } from "@/schemas/consulting";
import { getClient, calcChatKrw } from "@/lib/claude/chat";
import { VisibilityError } from "@/lib/visibility/http";
import { collectInput } from "./input";
import { snapshotHash } from "./hash";
import { VERSIONS, RESERVE_KRW, MAX_OUTPUT_TOKENS, strategyTool, buildPrompt, repairPrompt } from "./prompt";
import { judgeStrategy, usageOf } from "./judge";
import { MARKET_CURRENCY } from "./validate";
import { canRetry, ownedDomain, findExisting, existingResult, claimReport, beginAttempt, reportDto } from "./data";
import { markRejected, markUncertain, settleReport } from "./budget";
export async function generateReport(ownerId: string, input: z.infer<typeof consultingCreateSchema>, deadline = Infinity) {
    const requireTime = (milliseconds: number) => {
        if (Date.now() + milliseconds >= deadline)
            throw new VisibilityError('deadline_exceeded', '실행 시간이 부족하여 다음 실행으로 연기합니다.', 409);
    };
    requireTime(210000);
    const domain = await ownedDomain(ownerId, input.domainId);
    if ((input.market && input.market !== domain.market) ||
        (input.monthlyMarketingBudget && input.monthlyMarketingBudget.currency !== MARKET_CURRENCY[domain.market]))
        throw new VisibilityError("bad_request", "도메인 시장과 통화를 확인하세요.", 400);
    const now = new Date();
    const ga4 = await collectGa4(ownerId, domain.id, completedRange(now));
    requireTime(160000);
    const snapshot = freezeSnapshot(await collectInput(ownerId, domain, input.monthlyMarketingBudget ?? null, now, { ga4 }), "v3");
    if (!snapshot.sourceStatus.some(s => ["seo", "geo", "ga4"].includes(s.source) && (s.status === "available" || s.status === "partial" || s.status === "stale")))
        throw new VisibilityError("data_required", "SEO·AI 가시성·GA4 중 사용 가능한 데이터가 없습니다. 데이터 연결 후 다시 시도하세요.", 409);
    const hash = snapshotHash({ snapshot, ...VERSIONS });
    const reuse = (row: Parameters<typeof existingResult>[0]) => {
        const result = existingResult(row);
        if (result instanceof Error)
            throw result;
        return result;
    };
    const existing = await findExisting(ownerId, domain.id, hash);
    if (existing && !canRetry(existing))
        return reuse(existing);
    let client: ReturnType<typeof getClient>, messages: ReturnType<typeof buildPrompt>;
    try {
        client = getClient();
        messages = buildPrompt(snapshot);
    }
    catch {
        throw new VisibilityError("llm_failed", "전략 생성 준비에 실패했습니다.", 502);
    }
    requireTime(75000);
    const attemptId = randomUUID();
    const claim = await claimReport(ownerId, domain.id, snapshot, hash, VERSIONS, attemptId, RESERVE_KRW);
    if (!claim.claimed)
        return reuse(claim.row);
    const id = claim.row.id;
    await beginAttempt(ownerId, id, attemptId);
    let rejected = false;
    const ask = (body: typeof messages | ReturnType<typeof repairPrompt>) => client.chat.completions.create({ model: VERSIONS.model, messages: body,
        max_tokens: MAX_OUTPUT_TOKENS, tools: [strategyTool], parallel_tool_calls: false,
        tool_choice: { type: "function", function: { name: "submit_strategy" } },
    }, { maxRetries: 0, timeout: 60000 });
    try {
        const first = await ask(messages).catch(error => {
            rejected = isDefinitiveRejection(error);
            throw error;
        });
        let usage = usageOf(first);
        let verdict = judgeStrategy(first, snapshot, id);
        // One repair: the validator's reason goes back to the model (prompt.ts repairPrompt). Only when a well-formed
        // tool call was rejected and the deadline allows another call; the reservation covers both (RESERVE_KRW).
        if (!verdict.strategy && verdict.call && Date.now() + 65000 < deadline) {
            const second = await ask(repairPrompt(messages, verdict.call, verdict.reason)).catch(error => {
                // A definitive rejection proves the repair never ran: settle the first call's known cost.
                // Anything else may have executed: fall through to the uncertain path (reservation kept).
                if (isDefinitiveRejection(error)) return null;
                throw error;
            });
            if (second) {
                const extra = usageOf(second);
                usage = { prompt_tokens: usage.prompt_tokens + extra.prompt_tokens, completion_tokens: usage.completion_tokens + extra.completion_tokens,
                    total_tokens: usage.total_tokens + extra.total_tokens };
                verdict = judgeStrategy(second, snapshot, id);
            }
        }
        const saved = await settleReport(ownerId, id, attemptId, usage, calcChatKrw(usage), verdict.strategy);
        if (!verdict.strategy)
            throw new VisibilityError("llm_failed", "생성 결과의 근거를 검증하지 못했습니다.", 502);
        return { data: reportDto(saved), reused: false };
    }
    catch (error) {
        if (error instanceof VisibilityError && error.code === "llm_failed")
            throw error;
        if (rejected) {
            try {
                await markRejected(ownerId, id, attemptId);
            } catch {
                throw Object.assign(new VisibilityError("generation_uncertain", "거절 결과 저장을 확인 중입니다.", 409), { reportId: id });
            }
            throw Object.assign(new VisibilityError("llm_failed", "외부 생성 요청이 거절되었습니다. 설정을 확인한 후 다시 시도하세요.", 502), { reportId: id });
        }
        try {
            await markUncertain(ownerId, id, attemptId);
        }
        catch {
            console.error("[consulting] uncertainty persistence failed", { reportId: id, attemptId });
        }
        throw Object.assign(new VisibilityError("generation_uncertain", "생성 비용을 확인 중입니다. 이력을 확인하세요.", 502), { reportId: id });
    }
}
