// scripts/db/apply-manual-migration.mjs — prisma/manual-migrations/*.sql 운영 적용기 (psql 없이 Prisma 로)
// 사용: node scripts/db/apply-manual-migration.mjs prisma/manual-migrations/20261104_ga4_pipeline.sql          (dry-run: 사전 점검·스냅샷만)
//       node scripts/db/apply-manual-migration.mjs prisma/manual-migrations/20261104_ga4_pipeline.sql --apply  (단일 트랜잭션 적용 + 사후 점검)
// 접속: .env.local 의 DIRECT_URL(없으면 DATABASE_URL). 접속 문자열은 호스트 앞부분만 출력한다.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { splitSqlStatements } from './split-sql.mjs';

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('SQL 파일 경로가 필요합니다.'); process.exit(1); }
const apply = flag === '--apply';

function envValue(key) {
  const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith(key + '='));
  return line ? line.slice(key.length + 1).trim().replace(/^["']+|["']+$/g, '') : undefined;
}
const url = process.env.MIGRATION_DATABASE_URL || envValue('DIRECT_URL') || envValue('DATABASE_URL');
if (!url || !/^postgres(ql)?:\/\//.test(url)) { console.error('접속 URL 을 찾지 못했습니다(.env.local DIRECT_URL/DATABASE_URL).'); process.exit(1); }
console.log('대상 DB:', new URL(url).hostname.split('.')[0]);

const db = new PrismaClient({ datasources: { db: { url } } });
const statements = splitSqlStatements(readFileSync(file, 'utf8'));
const hasColumn = async (table, column) => (await db.$queryRawUnsafe(
  `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`, table, column)).length > 0;

async function report(label) {
  const reviewed = await hasColumn('contents', 'review_status');
  const rows = await db.$queryRawUnsafe(reviewed
    ? `SELECT channel, status, origin, review_status, count(*)::int n FROM contents GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`
    : `SELECT channel, status, count(*)::int n FROM contents GROUP BY 1,2 ORDER BY 1,2`);
  console.log(`\n[${label}] contents 분포 (review_status 컬럼 ${reviewed ? '있음' : '없음'})`);
  console.table(rows);
  if (!reviewed) {
    // 백필 예측: 마이그레이션 SQL 과 같은 조건
    const [p] = await db.$queryRawUnsafe(`SELECT
      (SELECT count(*)::int FROM contents c WHERE c.id IN (SELECT i.content_job_id FROM content_plan_items i JOIN content_plans p ON p.id = i.content_plan_id WHERE p.auto_generate AND i.content_job_id IS NOT NULL)) AS will_be_auto,
      (SELECT count(*)::int FROM contents c WHERE c.status = 'draft') AS drafts,
      (SELECT count(*)::int FROM contents c WHERE c.status = 'draft' AND EXISTS (SELECT 1 FROM schedule_slots s WHERE s.content_id = c.id AND s.status = 'scheduled')) AS drafts_user_scheduled`);
    console.log('백필 예측 — origin=auto 로 표시될 글:', p.will_be_auto, '/ draft 전체:', p.drafts, '/ 그중 사용자 예약(approved 유지 후보):', p.drafts_user_scheduled);
  }
  const tables = await db.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('ga4_bindings','publish_claims','pipeline_runs') ORDER BY 1`);
  console.log('신규 테이블 존재:', tables.map(t => t.table_name).join(', ') || '(없음)');
}

try {
  await report('적용 전');
  const snapshot = {
    takenAt: new Date().toISOString(), file,
    contents: await db.$queryRawUnsafe(`SELECT id, owner_id, channel, status, created_at FROM contents`),
    schedule_slots: await db.$queryRawUnsafe(`SELECT id, content_id, channel, status FROM schedule_slots`),
    content_plan_items: await db.$queryRawUnsafe(`SELECT id, content_plan_id, content_job_id, status FROM content_plan_items`),
  };
  const dir = join(homedir(), 'm-master-db-backups'); mkdirSync(dir, { recursive: true });
  const out = join(dir, `snapshot-${snapshot.takenAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(out, JSON.stringify(snapshot), { mode: 0o600 });
  console.log(`\n스냅샷 저장: ${out} (contents ${snapshot.contents.length}건)`);
  if (!apply) { console.log(`\ndry-run 종료 — 실제 적용은 --apply (SQL 문 ${statements.length}개, 단일 트랜잭션)`); process.exit(0); }
  await db.$transaction(async tx => { for (const sql of statements) await tx.$executeRawUnsafe(sql); }, { timeout: 120000, maxWait: 10000 });
  console.log(`\n적용 완료 (${statements.length}개 문, 단일 트랜잭션)`);
  await report('적용 후');
} catch (error) {
  console.error('실패(트랜잭션 롤백):', error instanceof Error ? error.message.split('\n').slice(0, 3).join(' ') : error);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
