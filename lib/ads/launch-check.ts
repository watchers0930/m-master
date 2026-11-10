// lib/ads/launch-check.ts — 켜기 직전 재조회(locks.ts 전용). 미러가 아니라 네이버에서 지금 읽은 값으로 판정한다.
// - 상한 값: 캠페인·그룹·키워드는 verifyStored, 소재는 TEXT_45. 불일치면 켜지 않고 알림 ads.drift + 409 drift(field).
// - 검수: 키워드·소재는 inspectStatus가 APPROVED|ELIGIBLE이어야 한다(아니면 409 not_inspected). 캠페인·그룹은 검수 상태가 없다.
// - 읽은 검수 상태는 미러에 반영한다(동기화 쓰기 — lockVersion은 건드리지 않는다).
import type { AdAccount } from "@prisma/client";
import type { NaverAdsClient } from "@/lib/external/naver-searchad";
import { queueAlert } from "./alerts";
import { ENTITY_SCHEMAS, readEntity } from "./execution";
import { AdsHttpError, unexpectedNaverResponse } from "./http";
import type { LockKind } from "./invariants";
import type { MirrorDelegate, MirrorLockRow } from "./locks";
import { verifyStored } from "./verify-stored";

export const LAUNCHABLE_INSPECT = ["APPROVED", "ELIGIBLE"] as const;

export async function freshCheck(client: NaverAdsClient, account: AdAccount, type: LockKind, row: MirrorLockRow, mirror: MirrorDelegate): Promise<void> {
  const raw = await readEntity(client, type, row.naverId);
  const parsed = ENTITY_SCHEMAS[type].safeParse(raw);
  if (!parsed.success) throw unexpectedNaverResponse();
  const entity = parsed.data as { type?: string; inspectStatus?: string | null };
  const verdict = type === "ad" ? (entity.type === "TEXT_45" ? { ok: true as const } : { ok: false as const, field: "type" }) : verifyStored(type, account, raw);
  if (!verdict.ok) {
    try {
      await queueAlert(account.id, "ads.drift", { entity: type, naverId: row.naverId, field: verdict.field, at: "launch" });
    } catch (error) {
      console.error("[ads] drift alert queue failed", { type: error instanceof Error ? error.name : "unknown" });
    }
    throw new AdsHttpError("drift", "네이버 설정이 MINTEQ 상한과 달라 켜지 않았습니다. 네이버 화면에서 설정을 확인하세요.", 409, { field: verdict.field });
  }
  if (type !== "keyword" && type !== "ad") return;
  const status = entity.inspectStatus ?? null;
  await mirror.updateMany({ where: { id: row.id }, data: { inspectStatus: status } });
  if (!(LAUNCHABLE_INSPECT as readonly (string | null)[]).includes(status))
    throw new AdsHttpError("not_inspected", "네이버 검수가 끝나지 않았거나 반려된 항목은 켤 수 없습니다.", 409, { inspectStatus: status });
}
