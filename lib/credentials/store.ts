// lib/credentials/store.ts — channel_credentials 단일 접근 경로(암호화 저장 + 전환기 이중 읽기)
// - 쓰기: 비밀 필드는 항상 AES-256-GCM 암호화. 키가 없거나 잘못되면 쓰기 자체를 거부(fail-closed, 평문 저장 금지).
// - 읽기: `v1:` 접두는 복호화, 접두가 없으면 전환기 평문으로 받아들이고 값 없이 경고만 남긴다.
// - 복호화 실패는 CredentialCryptoError 그대로 throw한다(빈 값으로 숨기지 않는다). 경계에서 호출자가 번역한다.
//   예외: 목록·연결상태 화면용 함수는 행별 오류 상태로 돌려준다(값·암호문은 절대 마스킹하지 않음).
// - AAD context = `channel_credentials.<field>:<ownerId>:<channel>` — 다른 행·다른 필드로 옮긴 암호문은 열리지 않는다.

import { prisma } from '@/lib/prisma';
import { CredentialCryptoError, decryptSecret, encryptSecret, maskSecret, type CredentialCryptoReason } from '@/lib/crypto/credentials';
import { assertCredentialWritable, credentialKeyStatus } from './anchor';

export const SECRET_FIELDS = {
  accessToken: true,
  refreshToken: true,
  /** meta 중 비밀값. 나머지(clubId·menuId·pageId·businessId·clientId·client_id)는 식별자라 평문. */
  meta: ['clientSecret', 'client_secret'] as readonly string[],
} as const;

const SEALED_PREFIX = 'v1:';
const LIST_LIMIT = 50; // (ownerId, channel) 유일 — 채널 수만큼만 존재하지만 상한을 둔다
/** 채널 연동 화면이 다루는 채널(ga4는 설정 화면에서 따로 표시) */
export const SOCIAL_CHANNELS = ['naver_cafe', 'instagram', 'facebook'] as const;

export type CredentialMeta = Record<string, string>;

export interface DecryptedCredential {
  ownerId: string;
  channel: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  meta: CredentialMeta;
  updatedAt: Date | null;
}

/** undefined 필드는 기존 값을 유지한다(upsert update에서 제외). null은 비운다. */
export interface CredentialInput {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: string | null;
  meta?: CredentialMeta;
}

export type CredentialRowError = 'decrypt_failed';
/** recoverable: 런타임 키 = 정본(앵커) 키라서, 열리지 않는 행이 '다른 키로 쓴 행'임이 확정 → 재연결·해제로 복구 가능 */
export type MaskedCredentials = Record<string, { connected: boolean; masked: Record<string, string>; error?: CredentialRowError; recoverable?: boolean }>;

type ColumnField = 'access_token' | 'refresh_token';

export function credentialContext(field: ColumnField | `meta.${string}`, ownerId: string, channel: string): string {
  return `channel_credentials.${field}:${ownerId}:${channel}`;
}

/** 평문(전환기 레거시)인 비밀값인지 — 비어 있지 않은 문자열이면서 `v1:` 접두가 없음 */
export function isLegacyPlaintext(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith(SEALED_PREFIX);
}

/** 빈 값·null은 비밀이 아니므로 그대로 둔다(encryptSecret은 빈 평문을 거부한다). */
export function sealValue(value: string | null | undefined, context: string): string | null | undefined {
  if (value == null || value === '') return value;
  return encryptSecret(value, context);
}

// 같은 (채널, 사유)는 프로세스당 한 번만 기록한다(요청마다 반복되는 로그 폭주 방지). 실패 자체는 호출자가 계속 드러낸다.
const loggedDecryptFailures = new Set<string>();

/** 복호화 실패를 값 없이 기록한다(채널·사유 코드만, 프로세스당 (channel, reason) 1회). */
export function logDecryptFailure(channel: string, error: CredentialCryptoError): void {
  const key = `${channel}:${error.reason}`;
  if (loggedDecryptFailures.has(key)) return;
  if (loggedDecryptFailures.size >= 100) loggedDecryptFailures.clear();
  loggedDecryptFailures.add(key);
  console.error('[credentials] decrypt failed', { channel, reason: error.reason });
}

type OpenState = { legacy: boolean };

function openValue(value: unknown, context: string, state: OpenState): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith(SEALED_PREFIX)) return decryptSecret(value, context);
  if (value.length > 0) state.legacy = true;
  return value;
}

function sealMeta(meta: Record<string, unknown>, ownerId: string, channel: string, onlyLegacy = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const secret = SECRET_FIELDS.meta.includes(k) && typeof v === 'string' && (!onlyLegacy || isLegacyPlaintext(v));
    out[k] = secret ? (sealValue(v as string, credentialContext(`meta.${k}`, ownerId, channel)) ?? '') : v;
  }
  return out;
}

type RawRow = { accessToken?: unknown; refreshToken?: unknown; expiresAt?: unknown; meta?: unknown; updatedAt?: unknown };

function metaObject(meta: unknown): Record<string, unknown> | null {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : null;
}

function openRow(row: RawRow, ownerId: string, channel: string): DecryptedCredential {
  const state: OpenState = { legacy: false };
  const meta: CredentialMeta = {};
  for (const [k, v] of Object.entries(metaObject(row.meta) ?? {})) {
    if (typeof v !== 'string') continue;
    meta[k] = SECRET_FIELDS.meta.includes(k) ? (openValue(v, credentialContext(`meta.${k}`, ownerId, channel), state) ?? '') : v;
  }
  const result: DecryptedCredential = {
    ownerId, channel,
    accessToken: openValue(row.accessToken, credentialContext('access_token', ownerId, channel), state),
    refreshToken: openValue(row.refreshToken, credentialContext('refresh_token', ownerId, channel), state),
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : null,
    meta,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : null,
  };
  if (state.legacy) console.warn('[credentials] legacy plaintext', { channel });
  return result;
}

const FULL_SELECT = { accessToken: true, refreshToken: true, expiresAt: true, meta: true, updatedAt: true } as const;

/** 복호화된 자격증명. 행이 없으면 null, 복호화 실패는 CredentialCryptoError throw. */
export async function readChannelCredential(ownerId: string, channel: string): Promise<DecryptedCredential | null> {
  const row = await prisma.channelCredential.findUnique({ where: { ownerId_channel: { ownerId, channel } }, select: FULL_SELECT });
  return row ? openRow(row, ownerId, channel) : null;
}

/** 연결 상태 화면용. 값은 반환하지 않고, 복호화 실패는 error로 구분한다(연결됨으로 보이지 않게). */
export async function credentialPresence(ownerId: string, channel: string): Promise<{ hasRefreshToken: boolean; updatedAt: Date; error: CredentialRowError | null; reason: CredentialCryptoReason | null; recoverable: boolean } | null> {
  const row = await prisma.channelCredential.findUnique({ where: { ownerId_channel: { ownerId, channel } }, select: FULL_SELECT });
  if (!row) return null;
  try {
    const cred = openRow(row, ownerId, channel);
    return { hasRefreshToken: !!cred.refreshToken, updatedAt: row.updatedAt, error: null, reason: null, recoverable: true };
  } catch (error) {
    if (!(error instanceof CredentialCryptoError)) throw error;
    logDecryptFailure(channel, error);
    return { hasRefreshToken: false, updatedAt: row.updatedAt, error: 'decrypt_failed', reason: error.reason, recoverable: (await credentialKeyStatus()).writable };
  }
}

type LockedRow = { access_token: string | null; refresh_token: string | null; meta: unknown };

/**
 * 항상 암호화해서 저장한다.
 * - 런타임 키 kid == DB 앵커 kid 를 먼저 확인(비밀 필드가 없는 쓰기도 거부 — fail-closed, 공유 DB에 다른 키로 쓰기 차단).
 * - 같은 행에 남아 있는 전환기 평문 비밀 필드는 이번 쓰기에 포함되지 않아도 함께 암호화한다(부분 갱신 후 평문 잔존 금지).
 *   이를 위해 행을 FOR UPDATE로 잠그고 다시 읽는다(동시 쓰기와의 lost update 방지).
 */
export async function writeChannelCredential(ownerId: string, channel: string, data: CredentialInput): Promise<void> {
  await assertCredentialWritable();
  const sealed: { accessToken?: string | null; refreshToken?: string | null; expiresAt?: string | null; meta?: Record<string, unknown> } = {};
  if (data.accessToken !== undefined) sealed.accessToken = sealValue(data.accessToken, credentialContext('access_token', ownerId, channel));
  if (data.refreshToken !== undefined) sealed.refreshToken = sealValue(data.refreshToken, credentialContext('refresh_token', ownerId, channel));
  if (data.expiresAt !== undefined) sealed.expiresAt = data.expiresAt;
  if (data.meta !== undefined) sealed.meta = sealMeta(data.meta, ownerId, channel);
  await prisma.$transaction(async tx => {
    const [existing] = await tx.$queryRaw<LockedRow[]>`
      SELECT access_token, refresh_token, meta FROM channel_credentials WHERE owner_id = ${ownerId} AND channel = ${channel} FOR UPDATE`;
    const update = { ...sealed };
    if (existing) {
      if (update.accessToken === undefined && isLegacyPlaintext(existing.access_token)) {
        update.accessToken = sealValue(existing.access_token, credentialContext('access_token', ownerId, channel));
      }
      if (update.refreshToken === undefined && isLegacyPlaintext(existing.refresh_token)) {
        update.refreshToken = sealValue(existing.refresh_token, credentialContext('refresh_token', ownerId, channel));
      }
      const oldMeta = metaObject(existing.meta);
      if (update.meta === undefined && oldMeta && SECRET_FIELDS.meta.some(k => isLegacyPlaintext(oldMeta[k]))) {
        update.meta = sealMeta(oldMeta, ownerId, channel, true);
      }
    }
    // Prisma Json 입력 타입으로 맞춘다(meta가 없으면 키 자체를 넣지 않음 = 기존 값 유지)
    const asInput = ({ meta, ...rest }: typeof sealed) => (meta === undefined ? rest : { ...rest, meta: meta as Record<string, string> });
    await tx.channelCredential.upsert({
      where: { ownerId_channel: { ownerId, channel } },
      create: { ownerId, channel, ...asInput(sealed) },
      update: asInput(update),
    });
  });
}

/**
 * 채널 연동 화면용: 본인(ownerId)의 소셜 채널 행만 조회 → 복호화 → 마스킹.
 * 복호화 실패 행은 connected 유지 + error:'decrypt_failed' + 빈 masked(암호문을 마스킹하지 않는다).
 */
export async function listMaskedCredentials(ownerId: string): Promise<MaskedCredentials> {
  const rows = await prisma.channelCredential.findMany({
    where: { ownerId, channel: { in: [...SOCIAL_CHANNELS] } },
    select: { channel: true, ...FULL_SELECT },
    orderBy: { channel: 'asc' },
    take: LIST_LIMIT,
  });
  const out: MaskedCredentials = {};
  let recoverable: boolean | undefined; // 오류 행이 있을 때만 앵커를 확인(정상 목록은 추가 조회 없음)
  for (const row of rows) {
    let cred: DecryptedCredential;
    try { cred = openRow(row, ownerId, row.channel); }
    catch (error) {
      if (!(error instanceof CredentialCryptoError)) throw error;
      logDecryptFailure(row.channel, error);
      recoverable ??= (await credentialKeyStatus()).writable;
      out[row.channel] = { connected: true, error: 'decrypt_failed', masked: {}, recoverable };
      continue;
    }
    const masked: Record<string, string> = {};
    if (cred.accessToken) masked.accessToken = maskSecret(cred.accessToken);
    for (const [k, v] of Object.entries(cred.meta)) if (v.length > 0) masked[k] = maskSecret(v);
    out[row.channel] = { connected: true, masked };
  }
  return out;
}

/** 본인 행만 삭제. 삭제된 행 수를 돌려준다. */
export async function deleteChannelCredential(ownerId: string, channel: string): Promise<number> {
  const { count } = await prisma.channelCredential.deleteMany({ where: { ownerId, channel } });
  return count;
}
