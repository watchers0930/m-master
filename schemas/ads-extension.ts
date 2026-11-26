// schemas/ads-extension.ts — 확장소재(3.6단계) 입력 검증(라우트 strict)·AI 초안 출력 형태·네이버 응답 형태.
// 형태만 본다. 글자 수·기호·서브링크 개수·도메인은 lib/ads/extensions/rules.ts(린터)가 위반으로 보고한다.
import { z } from "zod";
import { NAVER_ID_RE } from "@/schemas/ads";

export const EXTENSION_TYPES = ["HEADLINE", "DESCRIPTION", "SUB_LINKS"] as const;
export type ExtensionType = (typeof EXTENSION_TYPES)[number];
const MAX_TEXT_INPUT = 200; // 형태 상한(입력 방어). 실제 한도(15·14·6자)는 린터
const MAX_URL_INPUT = 500;
export const MAX_SUB_LINKS_INPUT = 10;

function draftShape(strict: boolean) {
  const obj = strict ? z.strictObject : z.object;
  const link = obj({ name: z.string().max(MAX_TEXT_INPUT), url: z.string().max(MAX_URL_INPUT) });
  return obj({
    headline: z.string().max(MAX_TEXT_INPUT).optional(),
    promo: z.string().max(MAX_TEXT_INPUT).optional(),
    subLinks: z.array(link).max(MAX_SUB_LINKS_INPUT).optional(),
  });
}

/** 등록 요청 본문: 최소 한 종류. 빈 문자열·빈 배열은 '그 종류 안 함'과 같다(화면이 빈 칸을 보낼 수 있다). */
export const adsExtensionApplySchema = draftShape(true).refine(
  (v) => !!v.headline?.trim() || !!v.promo?.trim() || (v.subLinks?.length ?? 0) > 0,
  { message: "추가제목·홍보문구·서브링크 중 하나 이상을 입력하세요." },
);
export type AdsExtensionApplyInput = z.infer<typeof adsExtensionApplySchema>;
export const extensionLlmOutputSchema = draftShape(false);

const optText = z.string().nullable().optional();
// GET /ncc/ad-extensions?ownerId=… · POST /ncc/ad-extensions 응답(실측 2026-11-26). adExtension은 유형마다 모양이 달라 unknown으로 받는다.
export const naverAdExtensionSchema = z.object({
  nccAdExtensionId: z.string().regex(NAVER_ID_RE),
  ownerId: z.string().regex(NAVER_ID_RE),
  type: z.string(),
  userLock: z.boolean().optional(),
  inspectStatus: optText,
  status: optText,
  delFlag: z.boolean().optional(),
  adExtension: z.unknown().optional(),
});
export type NaverAdExtension = z.infer<typeof naverAdExtensionSchema>;
