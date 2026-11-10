// lib/credentials/anchor.ts — 정본 자격증명 키 앵커(credential_key_anchor) 판정
// 로컬 .env.local과 운영이 같은 DB를 공유한다. env(CREDENTIAL_KEY_ID)는 환경마다 따로 설정되므로 "같은 키"를 보장하지 못한다.
// 그래서 정본 kid를 DB 한 행에 고정하고, 모든 자격증명 쓰기(store·backfill)는 런타임 키 kid == 앵커 kid 일 때만 허용한다.
// - 앵커 없음 → not_configured, 다름 → key_mismatch (CredentialCryptoError, 값 없음)
// - 앵커는 한 번만 만든다(있으면 같은 값만 no-op, 다르면 거부). 운영 앵커는 운영 런타임의 POST /api/admin/credential-key만 쓴다
//   (런타임 자기 kid → 운영 kid == 앵커가 구조적으로 보장). scripts/crypto/set-anchor.ts는 운영 DB를 거부한다(anchor-target.ts).
// 캐시: 앵커 행은 한 번 생기면 바뀌지 않으므로(쓰기 1회 정책) 프로세스당 60초 TTL로 읽기 비용을 줄인다.
//   TTL이 영향을 주는 경우는 "없음 → 생성" 전이뿐이며, 그 경우 최대 60초 늦게 쓰기가 열린다(fail-closed 방향).
//   앵커와 다른 키는 캐시 여부와 무관하게 항상 거부된다. 캐시 키에는 비밀값이 없다(단일 행 id).
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { credentialKeyId, CredentialCryptoError } from '@/lib/crypto/credentials';

const ANCHOR_ID = 'default';
const TTL_MS = 60_000;
const KID_PATTERN = /^[0-9a-f]{16}$/;

type Db = Pick<PrismaClient, '$queryRaw'>;
let cached: { kid: string | null; until: number } | null = null;

/** Postgres undefined_table(42P01) — Prisma $queryRaw는 PrismaClientKnownRequestError code P2010, meta.code '42P01'로 드러낸다(PGlite 실측). */
function isUndefinedTable(error: unknown): boolean {
  const e = error as { code?: unknown; meta?: { code?: unknown } } | null;
  return !!e && e.code === 'P2010' && e.meta?.code === '42P01';
}

/**
 * 캐시 없이 앵커 kid를 읽는다(백필·스크립트용).
 * 앵커 테이블 자체가 없으면(마이그레이션 미적용) 설정 미완료 → CredentialCryptoError('not_configured')로 분류해
 * 쓰기·삭제가 처리된 503 경로를 타게 한다. 그 외 DB 오류(연결·타임아웃 등)는 숨기지 않고 그대로 던진다.
 */
export async function readAnchorKid(db: Db): Promise<string | null> {
  let rows: { kid: string }[];
  try { rows = await db.$queryRaw<{ kid: string }[]>`SELECT kid FROM credential_key_anchor WHERE id = ${ANCHOR_ID}`; }
  catch (error) {
    if (isUndefinedTable(error)) throw new CredentialCryptoError('not_configured');
    throw error;
  }
  return rows[0]?.kid ?? null;
}

/** 앱 런타임용: 60초 TTL 캐시. */
export async function anchorKid(): Promise<string | null> {
  if (cached && cached.until > Date.now()) return cached.kid;
  const kid = await readAnchorKid(prisma);
  cached = { kid, until: Date.now() + TTL_MS };
  return kid;
}

/** 테스트·앵커 생성 직후 재판정용 */
export function resetAnchorCache(): void {
  cached = null;
}

function judge(kid: string, anchor: string | null): void {
  if (!anchor) throw new CredentialCryptoError('not_configured');
  if (anchor !== kid) throw new CredentialCryptoError('key_mismatch');
}

/** 쓰기 가드: 런타임 키(형식 오류면 not_configured) kid가 앵커 kid와 같아야 한다. db를 주면 캐시 없이 판정. */
export async function assertCredentialWritable(db?: Db): Promise<string> {
  const kid = credentialKeyId();
  judge(kid, db ? await readAnchorKid(db) : await anchorKid());
  return kid;
}

export type CredentialKeyStatus = { kid: string | null; anchorKid: string | null; writable: boolean; reason?: 'not_configured' | 'key_mismatch' };

/** 운영 확인용(읽기 전용): 런타임 kid·앵커 kid·쓰기 가능 여부. 비밀값 없음. DB 오류는 throw. */
export async function credentialKeyStatus(): Promise<CredentialKeyStatus> {
  const anchor = await anchorKid();
  let kid: string;
  try { kid = credentialKeyId(); } catch { return { kid: null, anchorKid: anchor, writable: false, reason: 'not_configured' }; }
  try { judge(kid, anchor); } catch (error) {
    return { kid, anchorKid: anchor, writable: false, reason: (error as CredentialCryptoError).reason === 'key_mismatch' ? 'key_mismatch' : 'not_configured' };
  }
  return { kid, anchorKid: anchor, writable: true };
}

export type SetAnchorResult = 'created' | 'unchanged';
export type SetAnchorError = 'kid_invalid' | 'local_key_mismatch' | 'anchor_conflict';

export class AnchorError extends Error {
  constructor(readonly code: SetAnchorError) { super(`credential_anchor_${code}`); this.name = 'AnchorError'; }
}

/**
 * 앵커를 한 번만 만든다. 없으면 생성, 같으면 no-op, 다르면 거부(anchor_conflict).
 * 오타 kid로 앵커를 고정해 아무도 쓸 수 없게 되는 사고를 막기 위해, 이 프로세스의 키 kid도 같아야 한다(local_key_mismatch).
 */
export async function setAnchor(db: Pick<PrismaClient, '$queryRaw' | '$executeRaw'>, kid: string): Promise<SetAnchorResult> {
  if (typeof kid !== 'string' || !KID_PATTERN.test(kid)) throw new AnchorError('kid_invalid');
  if (credentialKeyId() !== kid) throw new AnchorError('local_key_mismatch');
  const inserted = await db.$executeRaw`INSERT INTO credential_key_anchor (id, kid) VALUES (${ANCHOR_ID}, ${kid}) ON CONFLICT (id) DO NOTHING`;
  const current = await readAnchorKid(db);
  if (current !== kid) throw new AnchorError('anchor_conflict');
  resetAnchorCache();
  return inserted ? 'created' : 'unchanged';
}
