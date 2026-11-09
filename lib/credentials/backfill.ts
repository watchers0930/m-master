// lib/credentials/backfill.ts — channel_credentials 평문 비밀값 → v1 암호문 백필(운영 1회성 이전용 핵심 로직)
// scripts/db/encrypt-channel-credentials.ts가 호출한다. store.ts와 분리한 이유: 행 잠금(FOR UPDATE)·updated_at 보존이
// 필요해 Prisma 모델 API가 아닌 raw SQL 트랜잭션을 쓰고, 앱 런타임 경로(store)와 섞지 않기 위함.
// 원칙: 평문 필드만 대상, 행마다 트랜잭션 → 잠금 재조회 → 암호화 → 재복호화 일치 확인 → 갱신 → 갱신 후 재조회 검증.
// 출력(리포트)에는 채널명과 개수만 담는다. 값·키·context는 담지 않는다.

import type { PrismaClient } from '@prisma/client';
import { credentialKeyId, decryptSecret, encryptSecret } from '@/lib/crypto/credentials';
import { credentialContext, isLegacyPlaintext, SECRET_FIELDS } from './store';

const PAGE_SIZE = 100;

type Row = { id: string; owner_id: string; channel: string; access_token: string | null; refresh_token: string | null; meta: unknown };

export interface BackfillReport {
  apply: boolean;
  scannedRows: number;
  updatedRows: number;
  /** channel → field → 평문(apply면 암호화한) 필드 수 */
  legacy: Record<string, Record<string, number>>;
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
  if (decryptSecret(blob, context) !== plain) throw new Error('credential_backfill_verify_failed');
  return blob;
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
    const ctx = (field: Parameters<typeof credentialContext>[0]) => credentialContext(field, row.owner_id, row.channel);
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
    if (!after) throw new Error('credential_backfill_verify_failed');
    const check = (blob: unknown, plain: unknown, context: string) => {
      if (!isLegacyPlaintext(plain)) return;
      if (typeof blob !== 'string' || decryptSecret(blob, context) !== plain) throw new Error('credential_backfill_verify_failed');
    };
    check(after.access_token, row.access_token, ctx('access_token'));
    check(after.refresh_token, row.refresh_token, ctx('refresh_token'));
    const afterMeta = metaObject(after.meta);
    for (const key of SECRET_FIELDS.meta) check(afterMeta?.[key], original?.[key], ctx(`meta.${key}`));
    if (legacyFields(after).length) throw new Error('credential_backfill_verify_failed');
    return { channel: row.channel, fields };
  });
}

function tally(report: BackfillReport, channel: string, fields: string[]) {
  if (!fields.length) return;
  const byField = report.legacy[channel] ??= {};
  for (const f of fields) byField[f] = (byField[f] ?? 0) + 1;
}

/** 기본 dry-run(쓰기 없음). apply=true일 때만 행별 트랜잭션으로 암호화한다. 키가 유효하지 않으면 시작 전에 throw. */
export async function backfillChannelCredentials(db: PrismaClient, { apply }: { apply: boolean }): Promise<BackfillReport> {
  credentialKeyId(); // not_configured면 여기서 중단(dry-run 포함)
  const report: BackfillReport = { apply, scannedRows: 0, updatedRows: 0, legacy: {} };
  let cursor = '';
  for (;;) {
    const page = await db.$queryRaw<Row[]>`
      SELECT id, owner_id, channel, access_token, refresh_token, meta FROM channel_credentials WHERE id > ${cursor} ORDER BY id LIMIT ${PAGE_SIZE}`;
    if (!page.length) break;
    for (const row of page) {
      report.scannedRows++;
      if (!legacyFields(row).length) continue;
      if (!apply) { tally(report, row.channel, legacyFields(row)); continue; }
      const sealed = await sealRow(db, row.id);
      if (sealed?.fields.length) { tally(report, sealed.channel, sealed.fields); report.updatedRows++; }
    }
    cursor = page[page.length - 1].id;
  }
  return report;
}
