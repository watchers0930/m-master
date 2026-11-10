// lib/ads/propose.ts — AI 광고 제안 초안 생성(LLM 호출 + 서버 검증 + 1회 교정). DB는 비용 원장만 쓴다(제안 저장은 proposals.ts).
// 절차:
//   1) 첫 호출 → JSON.parse → zod 형태(proposalLlmOutputSchema, 모르는 필드 버림) → checkPayload(개수·입찰·리서치 키워드·근거 덮어쓰기)
//      → lintPayload(소재·키워드 린트).
//   2) 형태·입찰 위반 또는 린트 위반이 있으면 교정 호출 1회(MAX_REPAIR_CALLS). 그 뒤에는 다시 부르지 않는다.
//   3) 최종 후보가 형태·입찰을 통과하면 남은 린트 위반과 함께 돌려준다(승인은 위반 0일 때만 — proposal-review.ts).
//      교정 답이 형태 위반이고 첫 답은 형태가 유효했다면 첫 답을 쓴다. 둘 다 무효면 502 ads_proposal_invalid.
// 비용: 매 호출 직후(검증 전) trackCost(kind 'ads', strict) — 검증에 실패해도 기록한다. 사용량이 없으면 보수적 추정.
// LLM 장애(throw)는 503 ads_llm_unavailable(응답이 없어 사용량을 모르므로 원장에 쓰지 않는다). SDK 재시도는 끈다(중복 과금 방지).
import type OpenAI from "openai";
import { toChatUsage } from "@/lib/claude/chat";
import { trackCost } from "@/lib/cost/tracker";
import { proposalLlmOutputSchema } from "@/schemas/ads-proposal";
import type { AdProposalKind, ProposalLintIssue, ProposalPayload, ProposalSourceKeyword } from "@/types/ads";
import { AdsHttpError } from "./http";
import type { Caps } from "./invariants";
import { checkPayload, lintPayload, lintProblems, shapeProblems, type Problem } from "./proposal-check";
import {
  buildProposalMessages, calcChatKrw, estimateUsage, MAX_OUTPUT_TOKENS, MAX_PROMPT_KEYWORDS, MAX_REPAIR_CALLS, PROPOSAL_MODEL,
  repairMessages, type ChatMessage,
} from "./proposal-prompt";

export { MAX_REPAIR_CALLS } from "./proposal-prompt";

export type LlmClient = Pick<OpenAI, "chat">;
export type GenerateInput = {
  ownerId: string;
  kind: AdProposalKind;
  caps: Caps;
  seeds: readonly string[];
  stats: readonly ProposalSourceKeyword[];
};
export type GenerateResult = {
  payload: ProposalPayload;
  lintIssues: ProposalLintIssue[];
  costKrw: number;
  /** 프롬프트에 넣은(=근거로 쓴) 통계 */
  sourceKeywords: ProposalSourceKeyword[];
};

const LLM_TIMEOUT_MS = 60_000;
type Candidate = { payload: ProposalPayload; lintIssues: ProposalLintIssue[] } | { payload: null; problems: Problem[] };

function evaluate(text: string, input: GenerateInput, stats: readonly ProposalSourceKeyword[]): Candidate {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { payload: null, problems: [{ path: "(root)", rule: "invalid_json", message: "응답이 JSON 객체 하나가 아닙니다." }] };
  }
  const shape = proposalLlmOutputSchema.safeParse(json);
  if (!shape.success) return { payload: null, problems: shapeProblems(shape.error) };
  const checked = checkPayload(shape.data, { kind: input.kind, caps: input.caps, stats, source: "llm" });
  if (checked.problems.length) return { payload: null, problems: checked.problems };
  return { payload: checked.payload, lintIssues: lintPayload(checked.payload) };
}

const problemsOf = (c: Candidate): Problem[] => (c.payload === null ? c.problems : lintProblems(c.lintIssues));
const needsRepair = (c: Candidate) => c.payload === null || c.lintIssues.length > 0;

export async function generateProposal(input: GenerateInput, llm: LlmClient): Promise<GenerateResult> {
  const stats = input.stats.slice(0, MAX_PROMPT_KEYWORDS);
  const messages = buildProposalMessages({ ...input, stats });
  let costKrw = 0;
  const ask = async (body: ChatMessage[]): Promise<string> => {
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await llm.chat.completions.create(
        { model: PROPOSAL_MODEL, messages: body, response_format: { type: "json_object" }, temperature: 0.2, max_tokens: MAX_OUTPUT_TOKENS },
        { timeout: LLM_TIMEOUT_MS, maxRetries: 0 },
      );
    } catch (error) {
      console.error("[ads] proposal LLM call failed", { type: error instanceof Error ? error.name : "unknown" });
      throw new AdsHttpError("ads_llm_unavailable", "AI 제안 생성을 호출하지 못했습니다. 잠시 후 다시 시도하세요.", 503);
    }
    const usage = response.usage ? toChatUsage(response.usage) : estimateUsage(body);
    const krw = calcChatKrw(usage);
    await trackCost({ ownerId: input.ownerId, kind: "ads", tokensIn: usage.prompt_tokens, tokensOut: usage.completion_tokens, krw }, { strict: true });
    costKrw += krw;
    const content = response.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  };

  let text = await ask(messages);
  let candidate = evaluate(text, input, stats);
  for (let repairs = 0; needsRepair(candidate) && repairs < MAX_REPAIR_CALLS; repairs++) {
    text = await ask(repairMessages(messages, text, problemsOf(candidate)));
    const retry = evaluate(text, input, stats);
    if (retry.payload === null && candidate.payload !== null) break; // 형태가 유효한 첫 답을 남은 린트 위반과 함께 쓴다
    candidate = retry;
  }
  if (candidate.payload === null)
    throw new AdsHttpError("ads_proposal_invalid", "AI가 규칙에 맞는 제안을 만들지 못했습니다. 다시 시도하거나 씨앗 키워드를 바꿔 보세요.", 502);
  return { payload: candidate.payload, lintIssues: candidate.lintIssues, costKrw, sourceKeywords: [...stats] };
}
