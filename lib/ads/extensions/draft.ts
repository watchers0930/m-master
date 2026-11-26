// lib/ads/extensions/draft.ts — 광고그룹 확장소재 AI 초안(저장하지 않는다 — 대장이 화면에서 고친 뒤 등록하면 apply.ts가 다시 검사한다).
// - 근거 데이터: 그룹의 키워드·소재 문구(미러), 광고 사이트 페이지 목록(pages.ts 사이트맵·제목). 모두 신뢰하지 않는 데이터로만 넘긴다
//   (지시는 SYSTEM 상수 하나 — proposal-prompt.ts와 같은 방식). 서브링크 주소는 페이지 목록에 있는 것만 남긴다(지어낸 주소 금지).
// - 검사: 형태(zod) → 페이지 목록 대조 → 린트(rules.ts). 위반이 있으면 교정 1회. 남은 위반은 issues로 돌려준다(등록은 위반 0일 때만).
// - 비용: 호출마다 원장(propose.ts askJson). 네이버 쓰기 없음(조회만: 채널). 프롬프트·답 읽기는 prompt.ts(순수 함수).
import { prisma } from "@/lib/prisma";
import { withAccountClient, type AdsDeps } from "../account-core";
import { AdsHttpError, unexpectedNaverResponse } from "../http";
import { readLandingUrl } from "../landing";
import { llmOf } from "../proposals";
import { askJson, type LlmClient } from "../propose";
import type { ChatMessage } from "../proposal-prompt";
import { assertReady, loadOwnedGroup } from "./apply";
import { sitePages, type SitePage } from "./pages";
import { buildExtensionMessages, MAX_CONTEXT_KEYWORDS, readDraft, REPAIR_TEXT } from "./prompt";
import { hostOf, lintExtensions, type ExtensionDraft, type ExtensionIssue } from "./rules";

const MAX_OUTPUT_TOKENS = 800;
export type ExtensionDraftResult = { draft: ExtensionDraft; issues: ExtensionIssue[]; pages: SitePage[]; landingHost: string; costKrw: number };
export type DraftDeps = AdsDeps & { llm?: LlmClient; fetchPage?: typeof fetch };

export async function draftExtensions(ownerId: string, groupId: string, deps: DraftDeps = {}): Promise<ExtensionDraftResult> {
  const { group, account } = await loadOwnedGroup(ownerId, groupId);
  assertReady(account);
  const llm = llmOf(deps);
  const host = hostOf(await withAccountClient(account, deps, (client) => readLandingUrl(client, account.businessChannelId)));
  if (!host) throw unexpectedNaverResponse();
  const [keywords, ads, pages] = await Promise.all([
    prisma.adKeyword.findMany({ where: { adAccountId: account.id, parentNaverId: group.naverId }, select: { keyword: true }, take: MAX_CONTEXT_KEYWORDS, orderBy: { id: "asc" } }),
    prisma.adCreative.findMany({ where: { adAccountId: account.id, parentNaverId: group.naverId }, select: { headline: true, description: true }, take: 5, orderBy: { id: "asc" } }),
    sitePages(host, deps.fetchPage),
  ]);
  const messages = buildExtensionMessages({ keywords: keywords.map((k) => k.keyword), ads, pages });
  let costKrw = 0;
  const ask = async (body: ChatMessage[]) => { const r = await askJson(llm, account.ownerId, body, MAX_OUTPUT_TOKENS); costKrw += r.krw; return r.text; };
  let text = await ask(messages);
  let draft = readDraft(text, pages);
  let issues = draft ? lintExtensions(draft, host) : [];
  if (!draft || issues.length) {
    const problems = draft ? issues : [{ target: "headline", index: null, rule: "schema", message: "응답이 요구한 JSON 형태가 아닙니다." }];
    text = await ask([...messages, { role: "assistant", content: text.slice(0, 4000) }, { role: "user", content: `${REPAIR_TEXT}\n${JSON.stringify(problems)}` }]);
    const retry = readDraft(text, pages);
    if (retry) { draft = retry; issues = lintExtensions(retry, host); }
  }
  if (!draft) throw new AdsHttpError("ads_extension_invalid", "AI가 규칙에 맞는 확장소재 초안을 만들지 못했습니다. 다시 시도하거나 직접 입력하세요.", 502);
  return { draft, issues, pages, landingHost: host, costKrw };
}
