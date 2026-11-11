// lib/ads/oplog.ts — 네이버 변이 원장(ad_operation_logs). 변이 1회 원칙을 추적한다(설계서 §5.3).
// - 보내기 전에 'sent' 행을 먼저 쓴다(원장 기록 실패 시 보내지 않음 — fail-closed).
// - 결과: ok | uncertain(5xx·타임아웃·성공 본문 형태 불일치) | failed(확정 거절). errorCode는 고정 사유 + 네이버 코드(정수)만 — '<사유>:<코드>'(키·본문 없음).
// - 성공 본문은 호출자가 준 zod 스키마로 parse한다. 실패하면 쓰기가 반영됐는지 모르는 것이므로 uncertain으로 기록하고
//   NaverAdsError('ads_uncertain')를 던진다 — 호출자는 재전송하지 말고 재조회로 대조한다.
// - ownerId·adAccountId는 AdAccount 행에서 온다(입력값 금지).
import { createHash } from "node:crypto";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { NaverAdsError, type NaverAdsClient, type NaverAdsQuery } from "@/lib/external/naver-searchad";

export type MutationAccount = { id: string; ownerId: string };
export type MutationClient = Pick<NaverAdsClient, "post" | "put">; // 끄기 전용 클라이언트(clientForPause)도 같은 모양
// proposalId: 제안 적용(Task 9)이 보낸 변이면 그 제안. 재개 시 이 원장으로 이미 보낸 단계를 찾는다.
export type Mutation = { step: string; method: "POST" | "PUT"; path: string; query?: NaverAdsQuery; body: unknown; naverId?: string; proposalId?: string };

export async function sendMutation<S extends z.ZodTypeAny>(
  client: MutationClient,
  account: MutationAccount,
  op: Mutation,
  schema: S,
  idOf?: (parsed: z.infer<S>) => string,
): Promise<z.infer<S>> {
  const requestHash = createHash("sha256").update(JSON.stringify([op.method, op.path, op.query ?? null, op.body])).digest("hex");
  const log = await prisma.adOperationLog.create({
    data: {
      ownerId: account.ownerId, adAccountId: account.id, proposalId: op.proposalId ?? null,
      step: op.step, method: op.method, path: op.path, requestHash, naverId: op.naverId ?? null,
    },
    select: { id: true },
  });
  const finish = (status: "ok" | "uncertain" | "failed", extra: { errorCode?: string; naverId?: string } = {}) =>
    prisma.adOperationLog.update({ where: { id: log.id }, data: { status, ...extra } });
  let raw: unknown;
  try {
    raw = op.method === "POST" ? await client.post(op.path, op.body, op.query) : await client.put(op.path, op.body, op.query);
  } catch (error) {
    const reason = error instanceof NaverAdsError ? error.reason : "transport_error";
    // 네이버 오류 코드(정수)만 덧붙인다 — 본문·메시지는 남기지 않는다(실운영 2026-11-11: 'ads_rejected'만 남아 1002를 화면에서 읽어야 했다)
    const code = error instanceof NaverAdsError && Number.isSafeInteger(error.naverCode) ? `:${error.naverCode}` : "";
    await finish(reason === "ads_uncertain" ? "uncertain" : "failed", { errorCode: `${reason}${code}` });
    throw error;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    await finish("uncertain", { errorCode: "unexpected_response" });
    throw new NaverAdsError("ads_uncertain");
  }
  await finish("ok", idOf ? { naverId: idOf(parsed.data) } : {});
  return parsed.data;
}
