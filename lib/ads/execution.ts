// lib/ads/execution.ts — 네이버 쓰기의 마지막 관문(비상 정지 스위치 + 계정 상태 재확인 + 원장 기록). 적용(apply)·켜기/끄기(locks)·
// 감시(Task 11)의 모든 네이버 변이는 여기 함수로만 보낸다.
// - 스위치: process.env.ADS_EXECUTION_ENABLED === 'true'일 때만 생성·켜기를 보낸다(fail-closed, 503 ads_paused).
//   요청당 1번이 아니라 변이마다 보내기 직전에 읽는다 — 적용 도중 꺼지면 그 뒤 쓰기는 하나도 나가지 않는다.
// - 끄기(userLock=true)는 스위치·계정 상태와 무관하게 허용한다(안전 방향). 공유예산 mq-cap 생성·붙이기는 적용 안에서 하므로 스위치를 따른다
//   (핫픽스 2026-11-11: 연결 시 생성 면제는 없어졌다 — createEntity·updateEntity).
// - 생성·켜기는 보내기 직전에 계정 행을 다시 읽어 status==='active'를 요구한다(아니면 ads_not_connected) — 해제(disconnect)와의 경합 창을 닫는다.
// - 원장 행의 ownerId·adAccountId는 계정 행에서 온다(입력값 금지). 모든 본문은 requests.ts 빌더로 만든다.
import type { z } from "zod";
import { NaverAdsError, type NaverAdsClient } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import { naverAdSchema, naverAdgroupSchema, naverCampaignSchema, naverKeywordSchema } from "@/schemas/ads";
import { AdsHttpError } from "./http";
import { sendMutation, type Mutation, type MutationAccount, type MutationClient } from "./oplog";
import { buildPause, buildResume, type LockKind, type ResumeReason } from "./requests";

export function isExecutionEnabled(): boolean {
  return process.env.ADS_EXECUTION_ENABLED === "true";
}

/** 스위치가 꺼져 있으면 503 ads_paused. 생성·켜기 직전마다 부른다. */
export function assertExecutionEnabled(): void {
  if (!isExecutionEnabled())
    throw new AdsHttpError("ads_paused", "광고 실행이 비상 정지 상태입니다. 끄기와 조회만 할 수 있습니다.", 503);
}

export const ENTITY_PATHS: Readonly<Record<LockKind, string>> = {
  campaign: "/ncc/campaigns", adgroup: "/ncc/adgroups", keyword: "/ncc/keywords", ad: "/ncc/ads",
};
export const ENTITY_SCHEMAS = {
  campaign: naverCampaignSchema, adgroup: naverAdgroupSchema, keyword: naverKeywordSchema, ad: naverAdSchema,
} as const;
export type EntityOf<K extends LockKind> = z.infer<(typeof ENTITY_SCHEMAS)[K]>;

/** 보내기 직전 계정 상태 재확인. 해제 중·키 무효·해제됨이면 쓰지 않는다. */
async function assertActive(account: MutationAccount): Promise<void> {
  const row = await prisma.adAccount.findFirst({ where: { id: account.id, ownerId: account.ownerId }, select: { status: true } });
  if (row?.status !== "active") throw new NaverAdsError("ads_not_connected");
}

async function assertWritable(account: MutationAccount): Promise<void> {
  assertExecutionEnabled();
  await assertActive(account);
}

/** 생성 POST(1회). 스위치·계정 상태를 이 순간 확인한 뒤 원장(oplog)을 거쳐 보낸다. */
export async function createEntity<S extends z.ZodTypeAny>(
  client: NaverAdsClient, account: MutationAccount, op: Mutation & { method: "POST" }, schema: S, idOf: (parsed: z.infer<S>) => string,
): Promise<z.infer<S>> {
  await assertWritable(account);
  return sendMutation(client, account, op, schema, idOf);
}

/** 켜기·끄기 외의 수정 PUT(1회, 예: 공유예산 붙이기 ?fields=sharedBudget). 스위치·계정 상태를 이 순간 확인한 뒤 원장을 거쳐 보낸다. */
export async function updateEntity<S extends z.ZodTypeAny>(
  client: NaverAdsClient, account: MutationAccount, op: Mutation & { method: "PUT" }, schema: S,
): Promise<z.infer<S>> {
  await assertWritable(account);
  return sendMutation(client, account, op, schema);
}

export type LockWrite = { step: string; proposalId?: string; reason?: ResumeReason };

/**
 * 켜기·끄기 PUT ?fields=userLock(최소 본문). 끄기는 항상 보내고, 켜기는 스위치 + 계정 active를 이 순간 확인한다.
 * 켜기 사유 기본값은 대장 승인(owner_approved). 가드 자동 재개(Task 11)만 guard_auto_resume을 넘긴다.
 */
export async function putUserLock<K extends LockKind>(
  client: MutationClient, account: MutationAccount, kind: K, naverId: string, locked: boolean, write: LockWrite,
): Promise<EntityOf<K>> {
  if (!locked) await assertWritable(account);
  const body = locked ? buildPause(kind, naverId) : buildResume(kind, naverId, write.reason ?? "owner_approved");
  return sendMutation(client, account, {
    step: write.step, method: "PUT", path: `${ENTITY_PATHS[kind]}/${naverId}`, query: { fields: "userLock" }, body, naverId,
    proposalId: write.proposalId,
  }, ENTITY_SCHEMAS[kind]) as Promise<EntityOf<K>>;
}

/** 단건 재조회(원본 그대로). 형태 검사는 호출자가 한다(verifyStored·ENTITY_SCHEMAS). */
export function readEntity(client: Pick<NaverAdsClient, "get">, kind: LockKind, naverId: string): Promise<unknown> {
  return client.get(`${ENTITY_PATHS[kind]}/${naverId}`);
}

export type ConfirmClient = MutationClient & Pick<NaverAdsClient, "get">;

/**
 * 끄기의 단일 판정(Task 9 fix round 3 I-1): 끄기 PUT 뒤 다시 읽어 userLock===true일 때만 '꺼짐 확인'.
 * PUT 응답의 값은 믿지 않는다(200이어도 반영 안 될 수 있다). 재조회 실패·형태 불일치도 확인 못 함(false).
 * PUT 자체의 오류는 그대로 던진다. 적용(inspect·재시도)·안전 끄기(safetyPause)·대장 끄기가 모두 이 함수로 판정한다.
 */
export async function pauseAndConfirm<K extends LockKind>(
  client: ConfirmClient, account: MutationAccount, kind: K, naverId: string, write: LockWrite,
): Promise<{ confirmed: boolean; entity: EntityOf<K> | null }> {
  await putUserLock(client, account, kind, naverId, true, write);
  let entity: EntityOf<K> | null = null;
  try {
    const parsed = ENTITY_SCHEMAS[kind].safeParse(await readEntity(client, kind, naverId));
    entity = parsed.success ? (parsed.data as EntityOf<K>) : null;
  } catch (error) {
    if (!(error instanceof NaverAdsError)) throw error;
  }
  return { confirmed: entity?.userLock === true, entity };
}
