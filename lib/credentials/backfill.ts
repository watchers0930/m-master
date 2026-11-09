// lib/credentials/backfill.ts — channel_credentials 평문 비밀값 → v1 암호문 백필(운영 1회성 이전용 핵심 로직)
// scripts/db/encrypt-channel-credentials.ts가 호출한다. store.ts와 분리한 이유: 행 잠금(FOR UPDATE)·updated_at 보존이
// 필요해 Prisma 모델 API가 아닌 raw SQL 트랜잭션을 쓰고, 앱 런타임 경로(store)와 섞지 않기 위함.
// 원칙
// 1) 사전 가드(쓰기 전): expectKid(운영자가 확인한 운영 kid) === 현재 키 kid === CREDENTIAL_KEY_ID.
// 2) 사전 검증(쓰기 전): 기존 v1 비밀 필드를 전부 복호화해 본다. 하나라도 열리지 않으면(다른 키로 쓴 행 혼재 등) 중단.
// 3) 평문 필드만 대상, 행마다 트랜잭션 → FOR UPDATE 잠금 재조회 → 암호화 → 재복호화 일치 확인 → 갱신 → 갱신 후 재조회 검증.
// 출력(리포트·오류)에는 채널명·개수·고정 코드만 담는다. 값·키·context는 담지 않는다.

import type { PrismaClient } from '@prisma/client';
import { assertCredentialWritable, CredentialCryptoError, decryptSecret, encryptSecret } from '@/lib/crypto/credentials';
import { credentialContext, isLegacyPlaintext, SECRET_FIELDS } from './store';

const PAGE_SIZE = 100;
const KID_PATTERN = /^[0-9a-f]{16}$/;

export type BackfillAbortCode = 'expect_kid_invalid' | 'expect_kid_mismatch' | 'existing_ciphertext_unreadable' | 'verify_failed';

/** 고정 코드 + 개수만 담는 중단 오류(값·키 없음) */
export class BackfillAbort extends Error {
  constructor(readonly code: BackfillAbortCode, readonly unreadable: Record<string, Record<string, number>> = {}) {
    super(`credential_backfill_${code}`);
    this.name = 'BackfillAbort';
  }
}

type Row = { id: string; owner_id: string; channel: string; access_token: string | null; refresh_token: string | null; meta: unknown };

export interface BackfillReport {
  apply: boolean;
  scannedRows: number;
  updatedRows: number;
  /** channel → field → 평문(apply면 암호화한) 필드 수 */
  legacy: Record<string, Record<string, number>>;
  /** channel → reason(key_mismatch·invalid_blob 등) → 열리지 않는 기존 v1 필드 수. apply는 비어 있지 않으면 중단 */
  unreadable: Record<string, Record<string, number>>;
}

function metaObject(meta: unknown): Record<string, unknown> | null {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : null;
}

function legacyFields(row: Row): string[] {
  const fields: string[] = [];
  if (isLegacyPlaintext(row.access_token)) fields.push('accessToken');
  if (isLegacyPlaintext(row.refresh_token)) fields.push('refreshToken');
  const meta = metaObject(row.meta);
  for (const key of SECRET_FIELDS.meta) if (meta && isLegacyPlaintext(meta[key])) fields.push(`meta.${key}`);
  return fields;
}

function sealVerified(plain: string, context: string): string {
  const blob = encryptSecret(plain, context);
  if (decryptSecret(blob, context) !== plain) throw new BackfillAbort('verify_failed');
  return blob;
}

type Ctx = Parameters<typeof credentialContext>[0];

/** 이미 v1인 비밀 필드를 모두 열어 본다. 실패 사유 코드만 센다(값 없음). */
function probeSealed(row: Row, into: Record<string, Record<string, number>>) {
  const fields: [unknown, Ctx][] = [[row.access_token, 'access_token'], [row.refresh_token, 'refresh_token']];
  const meta = metaObject(row.meta);
  for (const key of SECRET_FIELDS.meta) fields.push([meta?.[key], `meta.${key}`]);
  for (const [value, field] of fields) {
    if (typeof value !== 'string' || isLegacyPlaintext(value) || value === '') continue;
    try { decryptSecret(value, credentialContext(field, row.owner_id, row.channel)); }
    catch (error) {
      const reason = error instanceof CredentialCryptoError ? error.reason : 'unknown';
      const byReason = into[row.channel] ??= {};
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
  }
}

const SELECT_LOCKED = (tx: Pick<PrismaClient, '$queryRaw'>, id: string) => tx.$queryRaw<Row[]>`
  SELECT id, owner_id, channel, access_token, refresh_token, meta FROM channel_credentials WHERE id = ${id} FOR UPDATE`;

/** 한 행을 잠그고 평문 비밀 필드만 암호화한다. 암호화한 필드 목록을 돌려준다(이미 v1이면 빈 배열). */
async function sealRow(db: PrismaClient, id: string): Promise<{ channel: string; fields: string[] } | null> {
  return db.$transaction(async tx => {
    const [row] = await SELECT_LOCKED(tx, id);
    if (!row) return null;
    const fields = legacyFields(row);
    if (!fields.length) return { channel: row.channel, fields };
    const ctx = (field: Ctx) => credentialContext(field, row.owner_id, row.channel);
    const access = isLegacyPlaintext(row.access_token) ? sealVerified(row.access_token, ctx('access_token')) : row.access_token;
    const refresh = isLegacyPlaintext(row.refresh_token) ? sealVerified(row.refresh_token, ctx('refresh_token')) : row.refresh_token;
    const original = metaObject(row.meta);
    let meta: Record<string, unknown> | null = original;
    if (original) {
      meta = { ...original };
      for (const key of SECRET_FIELDS.meta) {
        const value = original[key];
        if (isLegacyPlaintext(value)) meta[key] = sealVerified(value, ctx(`meta.${key}`));
      }
    }
    const metaJson = meta ? JSON.stringify(meta) : row.meta == null ? null : JSON.stringify(row.meta);
    // updated_at은 건드리지 않는다(자격증명 자체는 바뀌지 않음 — 연결 시각 표시 보존)
    await tx.$executeRaw`UPDATE channel_credentials SET access_token = ${access}, refresh_token = ${refresh}, meta = ${metaJson}::jsonb WHERE id = ${id}`;
    // 커밋 전 재조회 → 재복호화가 원문과 같은지 확인(불일치면 throw → 롤백)
    const [after] = await SELECT_LOCKED(tx, id);
    if (!after) throw new BackfillAbort('verify_failed');
    const check = (blob: unknown, plain: unknown, context: string) => {
      if (!isLegacyPlaintext(plain)) return;
      let reopened: string | null;
      // 재조회 값이 열리지 않는 것도 검증 실패다(사유는 verify_failed 하나로 — 롤백됨)
      try { reopened = typeof blob === 'string' ? decryptSecret(blob, context) : null; } catch { reopened = null; }
      if (reopened !== plain) throw new BackfillAbort('verify_failed');
    };
    check(after.access_token, row.access_token, ctx('access_token'));
    check(after.refresh_token, row.refresh_token, ctx('refresh_token'));
    const afterMeta = metaObject(after.meta);
    for (const key of SECRET_FIELDS.meta) check(afterMeta?.[key], original?.[key], ctx(`meta.${key}`));
    if (legacyFields(after).length) throw new BackfillAbort('verify_failed');
    return { channel: row.channel, fields };
  });
}

function tally(report: BackfillReport, channel: string, fields: string[]) {
  if (!fields.length) return;
  const byField = report.legacy[channel] ??= {};
  for (const f of fields) byField[f] = (byField[f] ?? 0) + 1;
}

async function* pages(db: PrismaClient): AsyncGenerator<Row> {
  let cursor = '';
  for (;;) {
    const page = await db.$queryRaw<Row[]>`
      SELECT id, owner_id, channel, access_token, refresh_token, meta FROM channel_credentials WHERE id > ${cursor} ORDER BY id LIMIT ${PAGE_SIZE}`;
    if (!page.length) return;
    yield* page;
    cursor = page[page.length - 1].id;
  }
}

/**
 * 기본 dry-run(쓰기 없음). apply=true일 때만 행별 트랜잭션으로 암호화한다.
 * expectKid: 운영 앱 kid(16 hex, 읽기 전용으로 확인한 값). 현재 키와 다르면 어떤 읽기·쓰기 전에 중단.
 */
export async function backfillChannelCredentials(db: PrismaClient, { apply, expectKid }: { apply: boolean; expectKid: string }): Promise<BackfillReport> {
  // 키 형식 + CREDENTIAL_KEY_ID 일치(쓰기 가드)를 dry-run에서도 먼저 확인
  const kid = assertCredentialWritable();
  if (typeof expectKid !== 'string' || !KID_PATTERN.test(expectKid)) throw new BackfillAbort('expect_kid_invalid');
  if (expectKid !== kid) throw new BackfillAbort('expect_kid_mismatch');
  const report: BackfillReport = { apply, scannedRows: 0, updatedRows: 0, legacy: {}, unreadable: {} };
  // 1단계: 전 행 사전 검증 — 기존 암호문이 이 키로 모두 열리는지, 평문 필드가 몇 개인지
  const targets: string[] = [];
  for await (const row of pages(db)) {
    report.scannedRows++;
    probeSealed(row, report.unreadable);
    const fields = legacyFields(row);
    if (!fields.length) continue;
    targets.push(row.id);
    if (!apply) tally(report, row.channel, fields);
  }
  if (!apply) return report;
  if (Object.keys(report.unreadable).length) throw new BackfillAbort('existing_ciphertext_unreadable', report.unreadable);
  // 2단계: 평문이 있던 행만 행별 트랜잭션(잠금 재조회 기준으로 다시 판정 — 그 사이 앱이 암호화했으면 건너뜀)
  for (const id of targets) {
    const sealed = await sealRow(db, id);
    if (sealed?.fields.length) { tally(report, sealed.channel, sealed.fields); report.updatedRows++; }
  }
  return report;
}
