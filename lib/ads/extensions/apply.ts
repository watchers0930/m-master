// lib/ads/extensions/apply.ts — 광고그룹에 확장소재 등록(대장이 화면에서 내용을 확인하고 누른 등록 = 승인).
// 절차(그룹 1개, 요청 1번):
//   ① 스위치 on·계정 active·비즈채널 있음 ② 랜딩 호스트 읽기 → 린트(rules.ts, 위반이면 422 — 네이버 쓰기 0)
//   ③ 서브링크 생존 확인(pages.ts deadLinks, 죽은 링크면 422) ④ 네이버의 이 그룹 확장소재 목록 1회 조회
//   ⑤ 유형마다 ensureExtension → 결과(created·exists·limit·rejected) ⑥ 감사 로그 ads.extension_create.
// 유형마다 '생성 점유'(ad_extensions 행, (계정, 그룹, 유형) 유일):
//   - 행 created + 네이버에 살아 있음 → exists(덮어쓰지 않는다 — 바꾸려면 네이버에서 지운 뒤 다시). 시작 때 목록에 없으면 그 1건을 다시 읽어
//     정말 지워졌을 때만(404·삭제 표시) 행을 지우고 새로 만든다(동시 등록의 낡은 목록으로 중복 생성하지 않게).
//   - 행 creating(다른 실행이 만드는 중): 10분 안이면 409 extension_in_progress. 지났으면 CAS로 다시 잡고 원장 naverId 또는 그 점유의 내용(row.content)을
//     새 목록에서 찾는다(찾으면 exists — 이번 입력은 쓰지 않는다. 재전송 금지 —
//     원장에 보낸 흔적이 있으면 못 찾아도 다시 보내지 않고 409 extension_uncertain).
//   - 행 없음: 네이버에 그 유형이 이미 2개(그룹당 한도)면 limit. 아니면 행을 만들고(유일 충돌 = 409 진행 중) POST 1회(execution.ts createEntity — 원장·스위치·계정 확인).
//   - POST 불확실 → 목록 대조로만 확인, 없으면 행을 creating으로 남기고 409 extension_uncertain. 확정 거절 → 행 삭제, rejected(네이버 코드).
// 확장소재는 켜기·끄기 관리 대상이 아니다(prisma 모델 주석). 생성 시 userLock=false(requests.ts buildAdExtension).
import type { AdAccount, AdGroup } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverAdExtensionSchema, type AdsExtensionApplyInput, type ExtensionType, type NaverAdExtension } from "@/schemas/ads-extension";
import { isEntityId } from "@/schemas/id";
import { assertAdsOwner } from "../access";
import { loadOwnedAccount, notFound, withAccountClient, type AdsDeps } from "../account-core";
import { assertExecutionEnabled, createEntity } from "../execution";
import { AdsHttpError, unexpectedNaverResponse } from "../http";
import { readLandingUrl } from "../landing";
import { buildAdExtension } from "../requests";
import { deadLinks } from "./pages";
import { hostOf, lintExtensions, sameContent, toNaverBodies, type ExtensionBody, type ExtensionIssue } from "./rules";

export const STALE_EXTENSION_CLAIM_MS = 10 * 60_000;
export const NAVER_PER_TYPE_LIMIT = 2; // 그룹당 유형별 최대 2개(네이버 확장소재 도움말 faq/1134)
export type ExtensionOutcome = { type: ExtensionType; result: "created" | "exists" | "limit" | "rejected"; naverId: string | null; naverCode?: number };
export type ExtensionApplyResult = { outcomes: ExtensionOutcome[] };
export type ExtensionDeps = AdsDeps & { fetchPage?: typeof fetch };

const live = (e: NaverAdExtension) => e.delFlag !== true && e.status !== "DELETED";
const stepOf = (groupId: string, type: string, claimId: string) => `ext:${groupId}:${type}#${claimId}`;
const conflict = (code: "extension_in_progress" | "extension_uncertain") => new AdsHttpError(code, code === "extension_in_progress"
  ? "이 광고그룹의 확장소재를 다른 곳에서 등록하는 중입니다. 잠시 후 다시 확인하세요."
  : "확장소재 등록이 네이버에 반영됐는지 확인하지 못했습니다. 다시 보내지 않았습니다 — 네이버 광고 화면에서 확인하세요.", 409);

export async function listNaverExtensions(client: Pick<NaverAdsClient, "get">, groupId: string): Promise<NaverAdExtension[]> {
  const parsed = naverAdExtensionSchema.array().safeParse(await client.get("/ncc/ad-extensions", { ownerId: groupId }));
  if (!parsed.success) throw unexpectedNaverResponse();
  return parsed.data.filter((e) => e.ownerId === groupId);
}

export function invalidExtension(issues: readonly ExtensionIssue[]): AdsHttpError {
  return new AdsHttpError("extension_invalid", issues[0]?.message ?? "확장소재 내용을 확인하세요.", 422, { issueCount: issues.length, target: issues[0]?.target ?? null });
}

/** 확장소재 1건을 지금 읽어 살아 있는가. 404(실측 2026-11-26: 삭제 후 조회 = 404 code 4001)·삭제 표시면 false.
 *  그 밖의 오류는 던진다(모르면 지우지 않는다). */
async function stillLive(client: Pick<NaverAdsClient, "get">, naverId: string): Promise<boolean> {
  let raw: unknown;
  try {
    raw = await client.get(`/ncc/ad-extensions/${naverId}`);
  } catch (error) {
    if (error instanceof NaverAdsError && error.status === 404) return false;
    throw error;
  }
  const parsed = naverAdExtensionSchema.safeParse(raw);
  if (!parsed.success) throw unexpectedNaverResponse();
  return live(parsed.data);
}

type Ctx = { client: NaverAdsClient; account: AdAccount; group: AdGroup; naver: NaverAdExtension[]; now: Date };

async function markCreated(ctx: Ctx, claimId: string, e: NaverAdExtension): Promise<string> {
  await prisma.adExtension.update({
    where: { id: claimId },
    data: { status: "created", naverId: e.nccAdExtensionId, inspectStatus: e.inspectStatus ?? null, userLock: e.userLock ?? null, lastSyncedAt: ctx.now },
  });
  return e.nccAdExtensionId;
}

/** 목록에서 같은 유형·같은 내용이면서 다른 미러가 쓰지 않는 것(재전송 없이 대조). */
async function findSame(ctx: Ctx, body: ExtensionBody, fresh: boolean): Promise<NaverAdExtension | null> {
  const list = fresh ? await listNaverExtensions(ctx.client, ctx.group.naverId) : ctx.naver;
  const taken = new Set((await prisma.adExtension.findMany({ where: { adAccountId: ctx.account.id, parentNaverId: ctx.group.naverId, naverId: { not: null } }, select: { naverId: true } })).map((r) => r.naverId));
  return list.find((e) => live(e) && e.type === body.type && !taken.has(e.nccAdExtensionId) && sameContent(body.type, e.adExtension, body.adExtension)) ?? null;
}

async function send(ctx: Ctx, claimId: string, body: ExtensionBody): Promise<ExtensionOutcome> {
  const step = stepOf(ctx.group.naverId, body.type, claimId);
  try {
    const made = await createEntity(ctx.client, { id: ctx.account.id, ownerId: ctx.account.ownerId },
      { step, method: "POST", path: "/ncc/ad-extensions", body: buildAdExtension(ctx.account, ctx.group.naverId, body.type, body.adExtension) },
      naverAdExtensionSchema, (r) => r.nccAdExtensionId);
    return { type: body.type, result: "created", naverId: await markCreated(ctx, claimId, made) };
  } catch (error) {
    if (!(error instanceof NaverAdsError)) throw error;
    if (error.reason === "ads_uncertain") {
      const found = await findSame(ctx, body, true);
      if (found) return { type: body.type, result: "created", naverId: await markCreated(ctx, claimId, found) };
      throw conflict("extension_uncertain"); // 행은 creating으로 남긴다(재전송 금지)
    }
    if (error.reason === "ads_rejected") {
      await prisma.adExtension.delete({ where: { id: claimId } });
      return { type: body.type, result: "rejected", naverId: null, ...(Number.isSafeInteger(error.naverCode) ? { naverCode: error.naverCode } : {}) };
    }
    await prisma.adExtension.delete({ where: { id: claimId } }); // 인증·권한·한도 등: 반영되지 않은 확정 실패
    throw error;
  }
}

async function ensureExtension(ctx: Ctx, body: ExtensionBody): Promise<ExtensionOutcome> {
  const where = { adAccountId_parentNaverId_type: { adAccountId: ctx.account.id, parentNaverId: ctx.group.naverId, type: body.type } };
  let row = await prisma.adExtension.findUnique({ where });
  if (row?.status === "created") {
    // 요청 시작 때 읽은 목록은 낡았을 수 있다(동시 등록이 그 뒤에 만든 것 — codex HIGH). 지워졌다고 판단하기 전에 그 1건을 지금 다시 읽는다.
    if (row.naverId && (ctx.naver.some((e) => live(e) && e.nccAdExtensionId === row?.naverId) || await stillLive(ctx.client, row.naverId)))
      return { type: body.type, result: "exists", naverId: row.naverId };
    const { count } = await prisma.adExtension.deleteMany({ where: { id: row.id, status: "created", updatedAt: row.updatedAt } }); // 네이버에서 지워짐 → 다시 만든다
    if (count !== 1) throw conflict("extension_in_progress");
    row = null;
  }
  if (row) { // creating — 다른 실행 중이거나 죽은 실행
    if (row.claimedAt.getTime() > ctx.now.getTime() - STALE_EXTENSION_CLAIM_MS) throw conflict("extension_in_progress");
    const { count } = await prisma.adExtension.updateMany({ where: { id: row.id, status: "creating", claimedAt: row.claimedAt }, data: { claimedAt: ctx.now } });
    if (count !== 1) throw conflict("extension_in_progress");
    // 대조 기준은 이번 입력이 아니라 그 점유가 보낸 내용(row.content)이다 — 문구를 바꿔 다시 눌러도 먼저 만든 것을 찾는다(codex MED).
    const sent = await prisma.adOperationLog.findFirst({ where: { adAccountId: ctx.account.id, step: stepOf(ctx.group.naverId, body.type, row.id), status: { not: "failed" } }, select: { status: true, naverId: true } });
    const byLog = sent?.status === "ok" && sent.naverId ? (await listNaverExtensions(ctx.client, ctx.group.naverId)).find((e) => live(e) && e.nccAdExtensionId === sent.naverId) : undefined;
    const found = byLog ?? await findSame(ctx, { type: body.type, adExtension: row.content }, true);
    if (found) return { type: body.type, result: "exists", naverId: await markCreated(ctx, row.id, found) };
    if (sent) throw conflict("extension_uncertain");
    await prisma.adExtension.update({ where: { id: row.id }, data: { content: body.adExtension as Prisma.InputJsonValue } });
    return send(ctx, row.id, body);
  }
  if (ctx.naver.filter((e) => live(e) && e.type === body.type).length >= NAVER_PER_TYPE_LIMIT) return { type: body.type, result: "limit", naverId: null };
  let claimId: string;
  try {
    claimId = (await prisma.adExtension.create({
      data: { ownerId: ctx.account.ownerId, adAccountId: ctx.account.id, parentNaverId: ctx.group.naverId, type: body.type, content: body.adExtension as Prisma.InputJsonValue, claimedAt: ctx.now },
      select: { id: true },
    })).id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("extension_in_progress");
    throw error;
  }
  return send(ctx, claimId, body);
}

export async function loadOwnedGroup(ownerId: string, groupId: string): Promise<{ group: AdGroup; account: AdAccount }> {
  assertAdsOwner(ownerId);
  if (!isEntityId(groupId)) throw notFound();
  const group = await prisma.adGroup.findFirst({ where: { id: groupId, ownerId } });
  if (!group) throw notFound();
  return { group, account: await loadOwnedAccount(ownerId, group.adAccountId) };
}

export function assertReady(account: AdAccount): asserts account is AdAccount & { businessChannelId: string } {
  if (account.status !== "active" || !account.businessChannelId)
    throw new AdsHttpError("ads_account_not_ready", "광고 계정이 활성 상태이고 비즈채널이 선택돼 있어야 합니다.", 409);
}

export async function applyExtensions(ownerId: string, groupId: string, input: AdsExtensionApplyInput, deps: ExtensionDeps = {}): Promise<ExtensionApplyResult> {
  const { group, account } = await loadOwnedGroup(ownerId, groupId);
  assertExecutionEnabled();
  assertReady(account);
  const now = (deps.now ?? (() => new Date()))();
  const outcomes = await withAccountClient(account, deps, async (client) => {
    const host = hostOf(await readLandingUrl(client, account.businessChannelId));
    if (!host) throw unexpectedNaverResponse();
    const draft = { headline: input.headline, promo: input.promo, subLinks: input.subLinks };
    const issues = lintExtensions(draft, host);
    if (issues.length) throw invalidExtension(issues);
    const dead = draft.subLinks?.length ? await deadLinks(draft.subLinks.map((l) => l.url.trim()), host, deps.fetchPage) : [];
    if (dead.length) throw new AdsHttpError("sub_link_unreachable", `열리지 않는 서브링크 주소가 있습니다: ${dead.slice(0, 2).join(", ")}`, 422, { count: dead.length });
    const ctx: Ctx = { client, account, group, naver: await listNaverExtensions(client, group.naverId), now };
    const out: ExtensionOutcome[] = [];
    for (const body of toNaverBodies(draft)) out.push(await ensureExtension(ctx, body));
    return out;
  });
  await prisma.auditLog.create({
    data: { actor: ownerId, targetType: "ad_group", targetId: group.id, action: "ads.extension_create", payload: { outcomes: outcomes.map((o) => ({ type: o.type, result: o.result, naverCode: o.naverCode ?? null })) } },
  });
  return { outcomes };
}
