// schemas/ads-proposal.ts — AI 광고 제안 입력 검증(라우트 strict) + LLM 출력 형태(알 수 없는 필드는 버림).
// - 형태만 본다. 입찰 범위(70 ≤ bid ≤ proposalBidCeiling, 정수)는 lib/ads/invariants.ts checkProposalBid(→checkBid) 한 곳에서만 검사한다
//   (그래서 bidAmt는 여기서 unknown — 두 번째 입찰 검사를 만들지 않는다). 글자 수·표현은 린터(lib/ads/lint.ts) 몫이다.
// - 개수: 그룹 ≤ 5, 그룹당 키워드 ≤ 20, 소재 ≤ 3. 종류별 하한(LLM 그룹 2~5·소재 2~3, extend_group 그룹 1)은 lib/ads/proposal-check.ts.
import { z } from "zod";
import { entityId } from "@/schemas/id";
import { NAVER_ID_RE } from "@/schemas/ads";

export const PROPOSAL_KINDS = ["new_campaign", "extend_group"] as const;
export const PROPOSAL_STATUSES = ["draft", "pending_review", "approved", "rejected", "applying", "applied", "apply_failed"] as const;
export const MAX_GROUPS = 5;
export const MAX_KEYWORDS_PER_GROUP = 20;
export const MAX_CREATIVES = 3;
/** 수동 씨앗 상한 — lib/ads/keywords.ts MAX_SEEDS(25)·MAX_KEYWORD_LENGTH(40)와 같아야 한다(테스트로 고정). */
export const MAX_MANUAL_SEEDS = 25;
export const MAX_MANUAL_SEED_LENGTH = 40;
export const MAX_COPY_INPUT = 200; // 형태 상한(입력 방어). 실제 글자 수 규칙(15·45)은 린터가 위반으로 보고한다

const NO_CONTROL = /^[^\p{Cc}]*$/u;
const label = (max: number) => z.string().trim().min(1).max(max).regex(NO_CONTROL);

/** strict=true: 라우트 입력(모르는 필드 거부). false: LLM 출력(모르는 필드는 버림). */
function payloadShape(strict: boolean) {
  const obj = strict ? z.strictObject : z.object;
  const keyword = obj({
    keyword: z.string().min(1).max(100),
    bidAmt: z.unknown(),
    reason: label(200),
    evidence: z.unknown().optional(), // 받되 버린다 — 근거는 항상 서버가 통계로 채운다
  });
  const creative = obj({ headline: z.string().max(MAX_COPY_INPUT), description: z.string().max(MAX_COPY_INPUT) });
  const group = obj({
    name: label(40),
    bidAmt: z.unknown(),
    keywords: z.array(keyword).min(1).max(MAX_KEYWORDS_PER_GROUP),
    creatives: z.array(creative).min(1).max(MAX_CREATIVES),
  });
  return obj({ groups: z.array(group).min(1).max(MAX_GROUPS) });
}

export const proposalLlmOutputSchema = payloadShape(false);
export const proposalPayloadInputSchema = payloadShape(true);
export type ProposalPayloadShape = z.infer<typeof proposalLlmOutputSchema>;

const isoVersion = z.iso.datetime({ offset: true });

export const adsProposalCreateSchema = z
  .strictObject({
    accountId: entityId,
    kind: z.enum(PROPOSAL_KINDS),
    targetAdgroupId: z.string().regex(NAVER_ID_RE).optional(),
    domainId: entityId.optional(), // SEO·컨설팅 씨앗을 가져올 도메인(소유자 범위). 없으면 수동 씨앗만
    seeds: z.array(z.string().max(MAX_MANUAL_SEED_LENGTH, "씨앗 키워드는 40자 이하입니다."))
      .max(MAX_MANUAL_SEEDS, "씨앗 키워드는 25개 이하입니다.").optional(),
  })
  .refine((v) => (v.kind === "extend_group") === (v.targetAdgroupId !== undefined), {
    message: "기존 광고그룹 확장에만 대상 광고그룹을 지정합니다.",
  });
export type AdsProposalCreateInput = z.infer<typeof adsProposalCreateSchema>;

export const adsProposalEditSchema = z.strictObject({ expected_updated_at: isoVersion, payload: proposalPayloadInputSchema });
export type AdsProposalEditInput = z.infer<typeof adsProposalEditSchema>;

export const adsProposalReviewSchema = z.strictObject({
  decision: z.enum(["approve", "reject"]),
  expected_updated_at: isoVersion,
  reason: z.string().trim().max(500).regex(NO_CONTROL).optional(),
});
export type AdsProposalReviewInput = z.infer<typeof adsProposalReviewSchema>;

export const adsProposalListSchema = z.strictObject({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: entityId.optional(),
  status: z.enum(PROPOSAL_STATUSES).optional(),
  accountId: entityId.optional(),
});
export type AdsProposalListInput = z.infer<typeof adsProposalListSchema>;
