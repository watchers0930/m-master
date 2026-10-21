import { isDefinitiveRejection } from "./rejection";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { consultingCreateSchema } from "@/schemas/consulting";
import { getClient, toChatUsage, calcChatKrw } from "@/lib/claude/chat";
import { VisibilityError } from "@/lib/visibility/http";
import { collectInput } from "./input";
import { snapshotHash } from "./hash";
import { VERSIONS, RESERVE_KRW, MAX_OUTPUT_TOKENS, strategyTool, buildPrompt, fitSnapshot } from "./prompt";
import { MARKET_CURRENCY, validateStrategy } from "./validate";
import { canRetry, ownedDomain, findExisting, existingResult, claimReport, beginAttempt, reportDto } from "./data";
import { markRejected, markUncertain, settleReport } from "./budget";
export async function generateReport(ownerId: string, input: z.infer<typeof consultingCreateSchema>) {
    const domain = await ownedDomain(ownerId, input.domainId);
    if ((input.market && input.market !== domain.market) ||
        (input.monthlyMarketingBudget && input.monthlyMarketingBudget.currency !== MARKET_CURRENCY[domain.market]))
        throw new VisibilityError("bad_request", "도메인 시장과 통화를 확인하세요.", 400);
    const snapshot = fitSnapshot(await collectInput(ownerId, domain, input.monthlyMarketingBudget ?? null));
    if (!snapshot.sourceStatus.some(s => (s.source === "seo" || s.source === "geo") && (s.status === "available" || s.status === "partial" || s.status === "stale")))
        throw new VisibilityError("data_required", "SEO 또는 AI 가시성 데이터를 먼저 준비하세요. GA4 성과는 현재 지원하지 않습니다.", 409);
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
    const attemptId = randomUUID();
    const claim = await claimReport(ownerId, domain.id, snapshot, hash, VERSIONS, attemptId, RESERVE_KRW);
    if (!claim.claimed)
        return reuse(claim.row);
    const id = claim.row.id;
    await beginAttempt(ownerId, id, attemptId);
    let rejected = false;
    try {
        const response = await client.chat.completions.create({ model: VERSIONS.model, messages,
            max_tokens: MAX_OUTPUT_TOKENS, tools: [strategyTool], parallel_tool_calls: false,
            tool_choice: { type: "function", function: { name: "submit_strategy" } },
        }, { maxRetries: 0, timeout: 60000 }).catch(error => {
            rejected = isDefinitiveRejection(error);
            throw error;
        });
        if (!response.usage || ![response.usage.prompt_tokens, response.usage.completion_tokens].every(x => Number.isSafeInteger(x) && x >= 0))
            throw new Error("usage_missing");
        const usage = toChatUsage(response.usage);
        let strategy = null;
        try {
            const choice = response.choices[0], calls = choice?.message.tool_calls;
            // Forced tool_choice returns finish_reason "stop" (not "tool_calls") with a complete call;
            // reject only truncation/filtering ("length"/"content_filter"), not the normal forced case.
            if (!choice || !["stop", "tool_calls"].includes(choice.finish_reason) || choice.message.refusal || calls?.length !== 1 || calls[0].type !== "function" || calls[0].function.name !== "submit_strategy")
                throw new Error("invalid tool");
            strategy = validateStrategy(JSON.parse(calls[0].function.arguments), snapshot);
        }
        catch { /* Rejected outputs still settle their actual token cost. */ }
        const saved = await settleReport(ownerId, id, attemptId, usage, calcChatKrw(usage), strategy);
        if (!strategy)
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
        throw Object.assign(new VisibilityError("generation_uncertain", "생성 비용을 확인 중입니다. 이력을 확인하세요.", 409), { reportId: id });
    }
}
