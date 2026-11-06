import type OpenAI from "openai";
import { toChatUsage } from "@/lib/claude/chat";
import type { ConsultingSnapshot, ConsultingStrategy } from "@/types/consulting";
import { validateStrategy } from "./validate";
type Completion = OpenAI.Chat.Completions.ChatCompletion;
type StrategyCall = { id: string; function: { name: string; arguments: string } };
/** Provider usage is mandatory: without it the actual cost cannot be settled (caller keeps the reservation). */
export function usageOf(response: Completion) {
    if (!response.usage || ![response.usage.prompt_tokens, response.usage.completion_tokens].every(x => Number.isSafeInteger(x) && x >= 0))
        throw new Error("usage_missing");
    return toChatUsage(response.usage);
}
/**
 * One model answer → a validated strategy, or the rejection reason. `call` is returned only for a well-formed
 * submit_strategy call whose content failed validation (the only case a repair can fix); truncation, refusal or
 * a missing call are not repairable. The reason is logged (field/rule/≤24-char fragment, never the full output).
 */
export function judgeStrategy(response: Completion, snapshot: ConsultingSnapshot, reportId: string):
    { strategy: ConsultingStrategy | null; call: StrategyCall | null; reason: string } {
    const choice = response.choices[0], calls = choice?.message.tool_calls;
    // Forced tool_choice returns finish_reason "stop" (not "tool_calls") with a complete call;
    // reject only truncation/filtering ("length"/"content_filter"), not the normal forced case.
    const call = choice && ["stop", "tool_calls"].includes(choice.finish_reason) && !choice.message.refusal && calls?.length === 1
        && calls[0].type === "function" && calls[0].function.name === "submit_strategy" ? calls[0] : null;
    if (!call) return reject(reportId, choice?.finish_reason ?? null, "invalid tool", null);
    try {
        return { strategy: validateStrategy(JSON.parse(call.function.arguments), snapshot.llmInput ?? snapshot), call: null, reason: "" };
    } catch (error) {
        const issue = (error as { issues?: { path?: unknown[]; code?: string; message?: string }[] })?.issues?.[0];
        const reason = issue ? `zod:${issue.code}@${(issue.path ?? []).join(".")}:${String(issue.message ?? "").slice(0, 120)}`
            : String((error as Error)?.message ?? error).slice(0, 3000);
        return reject(reportId, choice.finish_reason, reason, { id: call.id, function: { name: call.function.name, arguments: call.function.arguments } });
    }
}
/** Log rule codes and field paths only; the offending fragments (model text that may quote untrusted stored
 * strings, e.g. names/phones) go to the repair message, never to logs (codex review 2026-11-06). */
export function loggableReason(reason: string) {
    return reason.split(" | ").map(r => r.replace(/^((?:zod:[^@]*@)?[^:]*(?:@[^:]*)?):[\s\S]*$/, "$1")).join(" | ").slice(0, 1000);
}
function reject(reportId: string, finishReason: string | null, reason: string, call: StrategyCall | null) {
    console.error("[consulting] strategy rejected", { reportId, finishReason, reason: loggableReason(reason), repairable: !!call });
    return { strategy: null, call, reason };
}
