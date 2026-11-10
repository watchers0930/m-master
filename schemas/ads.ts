// schemas/ads.ts — 광고 API 입력 검증(라우트·lib 공용, zod strict) + 네이버 응답 형태(성공 본문도 반드시 parse).
// - 입력: 고객ID는 앞자리 0 없는 십진수(정수 안전 범위), 키는 공백 없는 ASCII 인쇄문자 16~256자(헤더 안전), 라벨 1~50자·제어문자 금지.
// - 오류 메시지는 고정 문구다(입력값을 되돌려 싣지 않는다).
import { z } from "zod";
import { entityId } from "@/schemas/id";

export const NAVER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // nccCampaignId·sharedBudgetId·nccBusinessChannelId — URL 경로에 그대로 들어간다
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const NO_CONTROL = /^[^\p{Cc}]*$/u;

const adsKey = z.string().min(16, "키 길이를 확인하세요.").max(256, "키 길이를 확인하세요.").regex(PRINTABLE_ASCII, "키에는 공백 없는 영문·숫자·기호만 쓸 수 있습니다.");

export const adsCustomerIdSchema = z.string().regex(/^[1-9][0-9]{0,14}$/, "고객 ID는 숫자만 입력하세요.");
export const adsAccountIdSchema = entityId;
export const adsChannelIdSchema = z.string().regex(NAVER_ID_RE, "비즈채널 ID 형식이 올바르지 않습니다.");

export const adsConnectSchema = z.strictObject({
  customerId: adsCustomerIdSchema,
  apiKey: adsKey,
  secretKey: adsKey,
  label: z.string().trim().min(1, "라벨을 입력하세요.").max(50, "라벨은 50자 이하입니다.").regex(NO_CONTROL, "라벨에 제어문자를 쓸 수 없습니다."),
});
export type AdsConnectInput = z.infer<typeof adsConnectSchema>;

export const adsReplaceKeysSchema = z.strictObject({ action: z.literal("replace_keys"), apiKey: adsKey, secretKey: adsKey });
export const adsSelectChannelSchema = z.strictObject({ action: z.literal("select_channel"), channelId: adsChannelIdSchema });
export const adsAccountPatchSchema = z.discriminatedUnion("action", [adsReplaceKeysSchema, adsSelectChannelSchema]);
export type AdsReplaceKeysInput = Pick<z.infer<typeof adsReplaceKeysSchema>, "apiKey" | "secretKey">;

// ── 네이버 응답 형태(명세 naver/searchad-apidoc ncc). 필요한 필드만 엄격히, 나머지는 버린다 ──
const naverId = z.string().regex(NAVER_ID_RE);
const optText = z.string().nullable().optional();

// status: ELIGIBLE|PAUSED|DELETED(명세). DELETED는 userLock과 무관하게 노출·과금 없음
// editTm: 최근 수정 시각(명세 Campaign.editTm, RFC 3339). 빈 /stats 판정(spend.ts)에만 쓴다 — 형태가 달라도 목록 전체를 깨지 않게 null(=모름)로 받는다.
export const naverCampaignListSchema = z.array(z.object({ nccCampaignId: naverId, userLock: z.boolean(), status: optText, editTm: optText.catch(null) }));
// 목록은 다른 공유예산(형태가 다를 수 있음)도 섞여 있다 → 고르는 데 필요한 필드만. 고른 것은 단건 재조회 + verifyStored로 엄격 검증.
export const naverSharedBudgetListSchema = z.array(z.object({ sharedBudgetId: naverId, name: optText, status: optText }));
export const naverSharedBudgetCreatedSchema = z.object({ sharedBudgetId: naverId });
export const naverChannelSchema = z.object({
  nccBusinessChannelId: naverId,
  channelTp: z.string(),
  name: optText,
  channelKey: optText,
  pcInspectStatus: optText,
  mobileInspectStatus: optText,
  status: optText,
});
export const naverChannelListSchema = z.array(naverChannelSchema);
export type NaverChannel = z.infer<typeof naverChannelSchema>;

// GET /keywordstool 응답. 공식 명세의 200 스키마는 "keywordList"라는 제목의 배열이라 감싼 형태인지 최상위 배열인지 모호하다
// (컨트롤러 판정) → { keywordList: RelKwdStat[] }와 최상위 RelKwdStat[] 둘 다 받는다. 그 밖({}·null·빈 본문·목록 아닌 값)은 응답 오류.
// 수치는 숫자 또는 "< 10" 같은 문자열 → 해석은 lib/ads/keywords.ts.
const kwMetric = z.union([z.number(), z.string(), z.null()]).optional();
const naverKeywordRowSchema = z.object({
  relKeyword: z.string(),
  monthlyPcQcCnt: kwMetric,
  monthlyMobileQcCnt: kwMetric,
  monthlyAvePcCtr: kwMetric,
  monthlyAveMobileCtr: kwMetric,
  plAvgDepth: kwMetric,
  compIdx: kwMetric,
});
export const naverKeywordToolSchema = z
  .union([z.object({ keywordList: z.array(naverKeywordRowSchema) }), z.array(naverKeywordRowSchema)])
  .transform((body) => (Array.isArray(body) ? body : body.keywordList));
export type NaverKeywordRow = z.infer<typeof naverKeywordRowSchema>;

// ── 적용·켜기/끄기(Task 9) ──
// 켜기·끄기 입력. 경합 CAS는 미러 lockVersion으로 한다(updatedAt은 동기화 쓰기마다 바뀌어 거짓 충돌을 낸다 — 계획 brief와 다른 점).
export const ADS_LOCK_ENTITY_TYPES = ["campaign", "adgroup", "keyword", "ad"] as const;
export const adsLockEntityTypeSchema = z.enum(ADS_LOCK_ENTITY_TYPES);
export const adsLockSchema = z.strictObject({
  locked: z.boolean(),
  expected_lock_version: z.number().int().min(0).max(2_147_483_647),
});
export type AdsLockInput = z.infer<typeof adsLockSchema>;

// 네이버 엔티티 응답(명세 Campaign·Adgroup·AdKeyword·Ad). 식별·대조에 필요한 필드만 엄격히. 상한 값은 verifyStored가 따로 parse한다.
export const naverCampaignSchema = z.object({ nccCampaignId: naverId, name: z.string(), userLock: z.boolean(), status: optText });
export const naverAdgroupSchema = z.object({ nccAdgroupId: naverId, nccCampaignId: naverId, name: z.string(), userLock: z.boolean(), status: optText });
export const naverKeywordSchema = z.object({
  nccKeywordId: naverId, nccAdgroupId: naverId, keyword: z.string(), userLock: z.boolean(), inspectStatus: optText, status: optText,
});
// ⚠️ 소재 본문(ad)의 응답 형태는 명세가 "string(json-schema form)"으로만 적는다. 객체로 오면 대조에 쓰고, 아니면 null(대조 불가).
const naverAdBody = z.object({ headline: z.string(), description: z.string() }).nullable().catch(null);
export const naverAdSchema = z.object({
  nccAdId: naverId, nccAdgroupId: naverId, type: z.string(), userLock: z.boolean(), inspectStatus: optText, status: optText, ad: naverAdBody.optional(),
});
export const naverKeywordCreatedSchema = z.array(naverKeywordSchema).length(1);
// GET /stats 응답. 금액은 유한한 0 이상 숫자만(문자열·음수·누락은 형식 오류 → '모름').
export const naverStatsSchema = z.object({ data: z.array(z.object({ id: naverId, salesAmt: z.number().finite().nonnegative() })) });

// ── 감시·동기화(Task 11) ──
// GET /billing/bizmoney. ⚠️ ncc 명세 밖(설계서: ncc-heroes-billing.json) — 필드 bizmoney(원)만 엄격히 본다(Task 13 실측으로 좁힌다).
export const naverBizmoneySchema = z.object({ bizmoney: z.number().finite().nonnegative() });
// GET /stats(성과 수집). 횟수는 0 이상 정수, 금액은 0 이상 유한수(VAT 별도), 평균순위는 없을 수 있다. 형식이 다르면 그 묶음을 버린다.
const count = z.number().int().nonnegative();
export const naverStatsDetailSchema = z.object({
  data: z.array(z.object({
    id: naverId, impCnt: count, clkCnt: count, salesAmt: z.number().finite().nonnegative(), ccnt: count,
    avgRnk: z.number().finite().nonnegative().nullable().optional(),
  })),
});
// GET /ncc/keywords?ids=…, /ncc/ads?ids=… (명세: 배열)
export const naverKeywordListSchema = z.array(naverKeywordSchema);
export const naverAdListSchema = z.array(naverAdSchema);
