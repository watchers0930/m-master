// lib/ads/extensions/list.ts — 광고그룹의 확장소재 현황(네이버 목록 1회 조회 — 대장이 직접 만든 것·이미지형 포함). 네이버 쓰기 없음.
// MINTEQ 미러(ad_extensions created)에 있는 것은 mine=true, 그 검수 상태·켜짐은 읽은 값으로 갱신한다(동기화 쓰기).
import type { AdExtensionDTO, AdExtensionPendingDTO, AdGroupExtensionsDTO } from "@/types/ads";
import { prisma } from "@/lib/prisma";
import { EXTENSION_TYPES, type ExtensionType, type NaverAdExtension } from "@/schemas/ads-extension";
import { notFound, withAccountClient, type AdsDeps } from "../account-core";
import { AdsHttpError } from "../http";
import { listNaverExtensions, loadOwnedGroup, STALE_EXTENSION_CLAIM_MS } from "./apply";
import { sameContent } from "./rules";

const TYPE_LABEL: Readonly<Record<string, string>> = {
  HEADLINE: "추가제목", DESCRIPTION: "홍보문구", SUB_LINKS: "서브링크", POWER_LINK_IMAGE: "파워링크 이미지", IMAGE_SUB_LINKS: "이미지형 서브링크",
  PHONE: "전화번호", LOCATION: "위치정보", PRICE_LINKS: "가격링크", PROMOTION: "추가홍보문구", DESCRIPTION_EXTRA: "추가설명",
};

/** 화면용 한 줄(알려진 텍스트 3종만 본문을 보이고, 그 밖은 유형 이름만). */
export function summarize(e: Pick<NaverAdExtension, "type" | "adExtension">): string {
  const label = TYPE_LABEL[e.type] ?? e.type;
  const body = e.adExtension as Record<string, unknown> | unknown[] | null | undefined;
  if (e.type === "HEADLINE" && body && !Array.isArray(body) && typeof body.headline === "string") return `${label}: ${body.headline}`;
  if (e.type === "DESCRIPTION" && body && !Array.isArray(body) && typeof body.description === "string") return `${label}: ${body.description}`;
  if (e.type === "SUB_LINKS" && Array.isArray(body))
    return `${label}: ${body.map((x) => (x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name : "?")).join(" · ")}`;
  return label;
}

export async function groupExtensions(ownerId: string, groupId: string, deps: AdsDeps = {}): Promise<AdGroupExtensionsDTO> {
  const { group, account } = await loadOwnedGroup(ownerId, groupId);
  const naver = (await withAccountClient(account, deps, (client) => listNaverExtensions(client, group.naverId)))
    .filter((e) => e.delFlag !== true && e.status !== "DELETED");
  const rows = await prisma.adExtension.findMany({ where: { adAccountId: account.id, parentNaverId: group.naverId }, select: { id: true, naverId: true, status: true, type: true, claimedAt: true } });
  const mine = rows.filter((r) => r.status === "created");
  const byNaverId = new Map(mine.map((m) => [m.naverId, m.id]));
  const now = (deps.now ?? (() => new Date()))();
  await Promise.all(naver.filter((e) => byNaverId.has(e.nccAdExtensionId)).map((e) => prisma.adExtension.update({
    where: { id: byNaverId.get(e.nccAdExtensionId) as string }, data: { inspectStatus: e.inspectStatus ?? null, userLock: e.userLock ?? null, lastSyncedAt: now },
  })));
  const extensions: AdExtensionDTO[] = naver.map((e) => ({
    naverId: e.nccAdExtensionId, type: e.type, mine: byNaverId.has(e.nccAdExtensionId), summary: summarize(e), inspectStatus: e.inspectStatus ?? null, status: e.status ?? null,
  }));
  const pending: AdExtensionPendingDTO[] = rows.filter((r) => r.status === "creating")
    .map((r) => ({ type: r.type, stale: r.claimedAt.getTime() <= now.getTime() - STALE_EXTENSION_CLAIM_MS }));
  return { groupId: group.id, groupNaverId: group.naverId, extensions, pending };
}

/**
 * 막힌 등록 풀기(대장 조작): 등록이 불확실하게 끝나 행이 creating으로 10분 넘게 남으면 자동 재전송은 하지 않는다(apply.ts).
 * 대장이 '풀기'를 누르면 네이버 목록을 새로 읽어 원장의 그 점유 POST naverId 또는 같은 내용이 있으면 채택(created), 없으면 점유 행을 지운다 — 그 뒤 등록은 새 행·새 원장 단계로 보낸다.
 * 10분 안(실행 중일 수 있음)은 409 extension_in_progress. 네이버 쓰기 없음.
 */
export async function releaseExtension(ownerId: string, groupId: string, type: unknown, deps: AdsDeps = {}): Promise<{ result: "adopted" | "released" }> {
  const { group, account } = await loadOwnedGroup(ownerId, groupId);
  if (typeof type !== "string" || !(EXTENSION_TYPES as readonly string[]).includes(type)) throw notFound();
  const row = await prisma.adExtension.findUnique({ where: { adAccountId_parentNaverId_type: { adAccountId: account.id, parentNaverId: group.naverId, type } } });
  if (!row || row.status !== "creating") throw notFound();
  const now = (deps.now ?? (() => new Date()))();
  if (row.claimedAt.getTime() > now.getTime() - STALE_EXTENSION_CLAIM_MS)
    throw new AdsHttpError("extension_in_progress", "등록이 아직 진행 중일 수 있습니다. 10분 뒤에 다시 시도하세요.", 409);
  const naver = await withAccountClient(account, deps, (client) => listNaverExtensions(client, group.naverId));
  // 원장에 그 점유의 POST가 ok(naverId)로 남았으면 그 id가 정답이다(미러 기록만 실패한 경우 — 네이버에서 문구를 고쳤어도 찾는다, codex MED 2차)
  const log = await prisma.adOperationLog.findFirst({ where: { adAccountId: account.id, step: `ext:${group.naverId}:${type}#${row.id}`, status: "ok", naverId: { not: null } }, select: { naverId: true } });
  const taken = new Set(rowsTaken(await prisma.adExtension.findMany({ where: { adAccountId: account.id, parentNaverId: group.naverId, naverId: { not: null } }, select: { naverId: true } })));
  const alive = (e: (typeof naver)[number]) => e.delFlag !== true && e.status !== "DELETED";
  const found = (log?.naverId ? naver.find((e) => alive(e) && e.nccAdExtensionId === log.naverId) : undefined)
    ?? naver.find((e) => alive(e) && e.type === type && !taken.has(e.nccAdExtensionId) && sameContent(type as ExtensionType, e.adExtension, row.content));
  const where = { id: row.id, status: "creating", claimedAt: row.claimedAt };
  if (found) {
    const { count } = await prisma.adExtension.updateMany({ where, data: { status: "created", naverId: found.nccAdExtensionId, inspectStatus: found.inspectStatus ?? null, userLock: found.userLock ?? null, lastSyncedAt: now } });
    if (count !== 1) throw new AdsHttpError("extension_in_progress", "다른 곳에서 바뀌었습니다. 새로 불러오세요.", 409);
    await prisma.auditLog.create({ data: { actor: ownerId, targetType: "ad_group", targetId: group.id, action: "ads.extension_release", payload: { type, result: "adopted" } } });
    return { result: "adopted" };
  }
  const { count } = await prisma.adExtension.deleteMany({ where });
  if (count !== 1) throw new AdsHttpError("extension_in_progress", "다른 곳에서 바뀌었습니다. 새로 불러오세요.", 409);
  await prisma.auditLog.create({ data: { actor: ownerId, targetType: "ad_group", targetId: group.id, action: "ads.extension_release", payload: { type, result: "released" } } });
  return { result: "released" };
}

const rowsTaken = (xs: { naverId: string | null }[]) => xs.map((x) => x.naverId as string);
