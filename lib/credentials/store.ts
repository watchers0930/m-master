// lib/credentials/store.ts — channel_credentials 단일 접근 경로(암호화 저장 + 전환기 이중 읽기)
// - 쓰기: 비밀 필드는 항상 AES-256-GCM 암호화. 키가 없거나 잘못되면 쓰기 자체를 거부(fail-closed, 평문 저장 금지).
// - 읽기: `v1:` 접두는 복호화, 접두가 없으면 전환기 평문으로 받아들이고 값 없이 경고만 남긴다.
// - 복호화 실패는 CredentialCryptoError 그대로 throw한다(빈 값으로 숨기지 않는다). 경계에서 호출자가 번역한다.
// - AAD context = `channel_credentials.<field>:<ownerId>:<channel>` — 다른 행·다른 필드로 옮긴 암호문은 열리지 않는다.

import { prisma } from '@/lib/prisma';
import { credentialKeyId, decryptSecret, encryptSecret, maskSecret } from '@/lib/crypto/credentials';

export const SECRET_FIELDS = {
  accessToken: true,
  refreshToken: true,
  /** meta 중 비밀값. 나머지(clubId·menuId·pageId·businessId·clientId·client_id)는 식별자라 평문. */
  meta: ['clientSecret', 'client_secret'] as readonly string[],
} as const;

const SEALED_PREFIX = 'v1:';
const LIST_LIMIT = 50; // (ownerId, channel) 유일 — 채널 수만큼만 존재하지만 상한을 둔다

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

export type MaskedCredentials = Record<string, { connected: boolean; masked: Record<string, string> }>;

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

type OpenState = { legacy: boolean };

function openValue(value: unknown, context: string, state: OpenState): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith(SEALED_PREFIX)) return decryptSecret(value, context);
  if (value.length > 0) state.legacy = true;
  return value;
}

function sealMeta(meta: CredentialMeta, ownerId: string, channel: string): CredentialMeta {
  const out: CredentialMeta = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = SECRET_FIELDS.meta.includes(k) ? (sealValue(v, credentialContext(`meta.${k}`, ownerId, channel)) ?? '') : v;
  }
  return out;
}

type RawRow = { accessToken?: unknown; refreshToken?: unknown; expiresAt?: unknown; meta?: unknown; updatedAt?: unknown };

function openRow(row: RawRow, ownerId: string, channel: string): DecryptedCredential {
  const state: OpenState = { legacy: false };
  const meta: CredentialMeta = {};
  const rawMeta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta as Record<string, unknown> : {};
  for (const [k, v] of Object.entries(rawMeta)) {
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

/** 복호화된 자격증명. 행이 없으면 null, 복호화 실패는 CredentialCryptoError throw. */
export async function readChannelCredential(ownerId: string, channel: string): Promise<DecryptedCredential | null> {
  const row = await prisma.channelCredential.findUnique({
    where: { ownerId_channel: { ownerId, channel } },
    select: { accessToken: true, refreshToken: true, expiresAt: true, meta: true, updatedAt: true },
  });
  return row ? openRow(row, ownerId, channel) : null;
}

/** 연결 여부만 필요한 화면용(복호화하지 않음 — 값은 반환하지 않는다). */
export async function credentialPresence(ownerId: string, channel: string): Promise<{ hasRefreshToken: boolean; updatedAt: Date } | null> {
  const row = await prisma.channelCredential.findUnique({
    where: { ownerId_channel: { ownerId, channel } },
    select: { refreshToken: true, updatedAt: true },
  });
  return row ? { hasRefreshToken: !!row.refreshToken, updatedAt: row.updatedAt } : null;
}

/** 항상 암호화해서 저장한다. 암호화는 DB 호출 전에 모두 끝낸다(부분 쓰기 없음). */
export async function writeChannelCredential(ownerId: string, channel: string, data: CredentialInput): Promise<void> {
  credentialKeyId(); // 비밀 필드가 비어 있어도 키 미설정이면 쓰기 거부
  const sealed: { accessToken?: string | null; refreshToken?: string | null; expiresAt?: string | null; meta?: CredentialMeta } = {};
  if (data.accessToken !== undefined) sealed.accessToken = sealValue(data.accessToken, credentialContext('access_token', ownerId, channel));
  if (data.refreshToken !== undefined) sealed.refreshToken = sealValue(data.refreshToken, credentialContext('refresh_token', ownerId, channel));
  if (data.expiresAt !== undefined) sealed.expiresAt = data.expiresAt;
  if (data.meta !== undefined) sealed.meta = sealMeta(data.meta, ownerId, channel);
  await prisma.channelCredential.upsert({
    where: { ownerId_channel: { ownerId, channel } },
    create: { ownerId, channel, ...sealed },
    update: sealed,
  });
}

/** 본인(ownerId) 행만 조회 → 복호화 → 마스킹. 암호문을 마스킹하지 않는다. 복호화 실패는 throw. */
export async function listMaskedCredentials(ownerId: string): Promise<MaskedCredentials> {
  const rows = await prisma.channelCredential.findMany({
    where: { ownerId },
    select: { channel: true, accessToken: true, refreshToken: true, expiresAt: true, meta: true, updatedAt: true },
    orderBy: { channel: 'asc' },
    take: LIST_LIMIT,
  });
  const out: MaskedCredentials = {};
  for (const row of rows) {
    const cred = openRow(row, ownerId, row.channel);
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
