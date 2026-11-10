// app/api/ads/accounts/[id]/route.ts — 광고 계정 상세+채널(GET), 키 교체·비즈채널 선택(PATCH), 해제(DELETE).
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// 모든 조회는 세션 ownerId 범위 — 남의 계정 id는 404(IDOR). 허용목록 밖은 404, 변이는 같은 출처 증명 필수.
import { logAudit } from "@/lib/audit/logger";
import { disconnectAccount, getAccount, replaceKeys, selectChannel } from "@/lib/ads/accounts";
import { adsRoute } from "@/lib/ads/http";
import { jsonOk, parseBody, readJsonBody } from "@/lib/visibility/http";
import { adsAccountPatchSchema } from "@/schemas/ads";

// 해제(DELETE)는 켜진 캠페인마다 끄기 PUT을 차례로 보낸다 — 네이버 작업은 lib/ads/disconnect.ts DISCONNECT_WORK_MS(270초) 창 안에서만(최종 판정 A2).
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => jsonOk(await getAccount(ownerId, (await context.params).id)));
}

export async function PATCH(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => {
    const { id } = await context.params;
    const input = parseBody(adsAccountPatchSchema, await readJsonBody(request));
    if (input.action === "replace_keys") {
      const account = await replaceKeys(ownerId, id, input);
      await logAudit({ actor: ownerId, action: "ads.account.replace_keys", targetType: "ad_account", targetId: account.id });
      return jsonOk(account);
    }
    const account = await selectChannel(ownerId, id, input.channelId);
    await logAudit({ actor: ownerId, action: "ads.account.select_channel", targetType: "ad_account", targetId: account.id, payload: { channelId: input.channelId } });
    return jsonOk(account);
  });
}

export async function DELETE(request: Request, context: Context) {
  return adsRoute(request, async (ownerId) => {
    const account = await disconnectAccount(ownerId, (await context.params).id);
    await logAudit({ actor: ownerId, action: "ads.account.disconnect", targetType: "ad_account", targetId: account.id });
    return jsonOk(account);
  });
}
