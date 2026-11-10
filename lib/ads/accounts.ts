// lib/ads/accounts.ts — 네이버 검색광고 계정 연결·키 교체·비즈채널 선택·조회(설계서 §5.5-1, §5.6-1). 해제는 disconnect.ts.
// - 모든 진입점은 허용목록(assertAdsOwner) + ownerId 범위 조회. 남의 계정 id는 존재하지 않는 것과 같다(404).
// - 연결·교체: 저장 가능 여부(앵커) 확인 → 새 키로 GET /ncc/campaigns 검증 → sealForStorage 봉인 저장. 검증 실패면 아무것도 저장하지 않는다.
//   같은 (소유자, 고객ID)는 한 행(@@unique) — 해제(disabled)된 행도 재연결 시 같은 행을 재활성한다.
// - 불변식(앱 코드 강제, Prisma가 CHECK를 못 표현): status !== 'disabled' ⇒ 두 키 non-null. 키를 지우는 곳은 disconnect.ts 한 곳뿐이다.
// - 새 키 거부(연결·교체)는 400 ads_key_rejected이고 저장 계정 상태를 바꾸지 않는다. 저장 계정 키 무효는 account-core.markInvalidKey.
import { assertCredentialWritable } from "@/lib/credentials/anchor";
import { sealForStorage } from "@/lib/credentials/seal";
import { NaverAdsClient, NaverAdsError, adCredentialContext } from "@/lib/external/naver-searchad";
import { prisma } from "@/lib/prisma";
import {
  adsChannelIdSchema, adsConnectSchema, adsReplaceKeysSchema, naverChannelListSchema, naverChannelSchema,
  type AdsConnectInput, type AdsReplaceKeysInput, type NaverChannel,
} from "@/schemas/ads";
import type { AdAccountDTO, AdAccountWithChannels, AdChannelDTO } from "@/types/ads";
import { assertAdsOwner } from "./access";
import {
  accountDTO, listAccountDTOs, listCampaigns, loadOwnedAccount, notConnected, withAccountClient, type AdsDeps,
} from "./account-core";
import { AdsHttpError, unexpectedNaverResponse } from "./http";
import { ensureSharedBudget } from "./shared-budget";

export { markInvalidKey, type AdsDeps } from "./account-core";
export { disconnectAccount } from "./disconnect";

export const MAX_ACCOUNTS = 20;
export const MAX_CHANNELS = 200;
const APPROVED = new Set(["APPROVED", "ELIGIBLE"]);
const KEY_REJECTED: readonly string[] = ["ads_auth_failed", "ads_forbidden", "ads_not_connected"];

/** 새 키 검증(저장 전). 네이버가 키·고객ID를 거부하면 400 ads_key_rejected. 그 외(장애·한도)는 그대로 던진다. */
async function verifyNewKeys(customerId: string, keys: AdsReplaceKeysInput, deps: AdsDeps): Promise<NaverAdsClient> {
  await assertCredentialWritable(); // 저장 못 할 키는 네이버에 보내지도 않는다(CredentialCryptoError 그대로 전파)
  try {
    const client = new NaverAdsClient({ customerId, apiKey: keys.apiKey, secretKey: keys.secretKey }, deps.transport);
    await listCampaigns(client);
    return client;
  } catch (error) {
    if (error instanceof NaverAdsError && KEY_REJECTED.includes(error.reason))
      throw new AdsHttpError("ads_key_rejected", "네이버가 키를 거부했습니다. 고객 ID·API 키·비밀키를 확인하세요.", 400);
    throw error;
  }
}

async function sealKeys(ownerId: string, customerId: string, keys: AdsReplaceKeysInput) {
  return {
    apiKeyEnc: await sealForStorage(keys.apiKey, adCredentialContext("api_key", ownerId, customerId)),
    secretKeyEnc: await sealForStorage(keys.secretKey, adCredentialContext("secret_key", ownerId, customerId)),
    keyLast4: keys.apiKey.slice(-4), // 키는 16자 이상 ASCII(schemas/ads.ts) — 뒤 4자리만 화면에
  };
}

function toChannelDTO(c: NaverChannel): AdChannelDTO {
  const pc = c.pcInspectStatus ?? null, mobile = c.mobileInspectStatus ?? null;
  return {
    id: c.nccBusinessChannelId, name: c.name ?? null, url: c.channelKey ?? null, pcInspectStatus: pc, mobileInspectStatus: mobile,
    selectable: c.channelTp === "SITE" && c.status !== "DELETED" && APPROVED.has(pc ?? "") && APPROVED.has(mobile ?? ""),
  };
}

async function listSiteChannels(client: NaverAdsClient): Promise<AdChannelDTO[]> {
  const parsed = naverChannelListSchema.safeParse(await client.get("/ncc/channels", { channelTp: "SITE" }));
  if (!parsed.success) throw unexpectedNaverResponse();
  return parsed.data.filter((c) => c.channelTp === "SITE").slice(0, MAX_CHANNELS).map(toChannelDTO);
}

export async function listAccounts(ownerId: string): Promise<AdAccountDTO[]> {
  assertAdsOwner(ownerId);
  return listAccountDTOs(ownerId, MAX_ACCOUNTS);
}

/** 연결: 검증 → 봉인 저장(같은 고객ID면 같은 행 갱신·재활성) → 공유예산 mq-cap 확인·생성 → SITE 채널 목록. */
export async function connectAccount(ownerId: string, input: AdsConnectInput, deps: AdsDeps = {}): Promise<AdAccountWithChannels> {
  assertAdsOwner(ownerId);
  const data = adsConnectSchema.parse(input);
  const client = await verifyNewKeys(data.customerId, data, deps);
  const sealed = await sealKeys(ownerId, data.customerId, data);
  const verified = { ...sealed, status: "active", disconnectFromStatus: null, lastVerifiedAt: new Date(), label: data.label };
  const row = await prisma.adAccount.upsert({
    where: { ownerId_naverCustomerId: { ownerId, naverCustomerId: data.customerId } },
    create: { ownerId, naverCustomerId: data.customerId, ...verified },
    update: verified,
  });
  const sharedBudgetId = await ensureSharedBudget(client, row);
  if (sharedBudgetId !== row.sharedBudgetId) await prisma.adAccount.updateMany({ where: { id: row.id, ownerId }, data: { sharedBudgetId } });
  return { account: await accountDTO(ownerId, row.id), channels: await listSiteChannels(client) };
}

/** 키 교체(spec §5.6-1): 새 키가 검증 GET을 통과한 경우에만 바꾼다. 무효 키 상태에서 복구하는 경로이기도 하다. */
export async function replaceKeys(ownerId: string, accountId: string, input: AdsReplaceKeysInput, deps: AdsDeps = {}): Promise<AdAccountDTO> {
  assertAdsOwner(ownerId);
  const keys = adsReplaceKeysSchema.parse({ action: "replace_keys", apiKey: input.apiKey, secretKey: input.secretKey });
  const row = await loadOwnedAccount(ownerId, accountId);
  if (row.status === "disabled") throw notConnected();
  await verifyNewKeys(row.naverCustomerId, keys, deps);
  const sealed = await sealKeys(row.ownerId, row.naverCustomerId, keys);
  const { count } = await prisma.adAccount.updateMany({
    where: { id: row.id, ownerId, status: { in: ["active", "invalid_key"] } }, // 그 사이 해제됐으면 되살리지 않는다
    data: { ...sealed, status: "active", lastVerifiedAt: new Date() },
  });
  if (count === 0) throw notConnected();
  return accountDTO(ownerId, row.id);
}

/** 비즈채널 선택: 선택 시점에 서버가 다시 조회해 SITE이고 PC·모바일 검수가 모두 APPROVED|ELIGIBLE일 때만 저장. */
export async function selectChannel(ownerId: string, accountId: string, channelId: string, deps: AdsDeps = {}): Promise<AdAccountDTO> {
  assertAdsOwner(ownerId);
  const id = adsChannelIdSchema.parse(channelId);
  const row = await loadOwnedAccount(ownerId, accountId);
  if (row.status === "disabled") throw notConnected();
  const channel = await withAccountClient(row, deps, async (client) => {
    const parsed = naverChannelSchema.safeParse(await client.get(`/ncc/channels/${id}`));
    if (!parsed.success) throw unexpectedNaverResponse();
    return toChannelDTO(parsed.data);
  });
  if (channel.id !== id || !channel.selectable)
    throw new AdsHttpError("channel_not_approved", "비즈채널 검수가 끝나지 않았습니다(PC·모바일 모두 승인 필요). 검수 후 다시 선택하세요.", 409, {
      pcInspectStatus: channel.pcInspectStatus, mobileInspectStatus: channel.mobileInspectStatus,
    });
  const { count } = await prisma.adAccount.updateMany({ where: { id: row.id, ownerId, status: "active" }, data: { businessChannelId: id } });
  if (count === 0) throw notConnected();
  return accountDTO(ownerId, row.id);
}

/** 계정 상세 + SITE 채널 목록(검수 후 다시 선택하는 화면용). 연결 안 됨·무효 키면 네이버를 부르지 않고 채널은 빈 목록. */
export async function getAccount(ownerId: string, accountId: string, deps: AdsDeps = {}): Promise<AdAccountWithChannels> {
  assertAdsOwner(ownerId);
  const row = await loadOwnedAccount(ownerId, accountId);
  const channels = row.status === "active" ? await withAccountClient(row, deps, listSiteChannels) : [];
  return { account: await accountDTO(ownerId, row.id), channels };
}
