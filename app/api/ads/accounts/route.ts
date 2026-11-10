// app/api/ads/accounts/route.ts — 광고 계정 목록(GET)·연결(POST). 허용목록 밖은 404, 변이는 같은 출처 증명 필수.
// 인증: adsRoute = authenticated(requireSession, request, { requireOrigin: true }) → assertAdsOwner(허용목록) — lib/ads/http.ts.
// 응답 DTO에는 keyLast4만 있다(키 원문·암호문 없음). 입력은 schemas/ads.ts strict 검증.
import { logAudit } from "@/lib/audit/logger";
import { connectAccount, listAccounts } from "@/lib/ads/accounts";
import { adsRoute } from "@/lib/ads/http";
import { jsonOk, parseBody, readJsonBody } from "@/lib/visibility/http";
import { adsConnectSchema } from "@/schemas/ads";

export async function GET(request: Request) {
  return adsRoute(request, async (ownerId) => jsonOk(await listAccounts(ownerId)));
}

export async function POST(request: Request) {
  return adsRoute(request, async (ownerId) => {
    const input = parseBody(adsConnectSchema, await readJsonBody(request));
    const result = await connectAccount(ownerId, input);
    await logAudit({ actor: ownerId, action: "ads.account.connect", targetType: "ad_account", targetId: result.account.id });
    return jsonOk(result, 201);
  });
}
