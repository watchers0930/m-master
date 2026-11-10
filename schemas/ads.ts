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
export const naverCampaignListSchema = z.array(z.object({ nccCampaignId: naverId, userLock: z.boolean(), status: optText }));
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
