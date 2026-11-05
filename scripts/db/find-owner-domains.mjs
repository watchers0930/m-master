// scripts/db/find-owner-domains.mjs — 읽기 전용: 계정·도메인 목록(GA4 바인딩 대상 확인용). 비밀값은 출력하지 않는다.
// 사용: node scripts/db/find-owner-domains.mjs [도메인 일부 문자열]
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith('DATABASE_URL='));
const url = line?.slice('DATABASE_URL='.length).trim().replace(/^["']+|["']+$/g, '');
const db = new PrismaClient({ datasources: { db: { url } } });
const needle = process.argv[2] ?? '';
try {
  const domains = await db.domain.findMany({ where: needle ? { url: { contains: needle } } : {},
    select: { id: true, url: true, ownerId: true, owner: { select: { email: true } } }, orderBy: { ownerId: 'asc' }, take: 50 });
  console.table(domains.map(d => ({ owner_id: d.ownerId, email: d.owner.email, domain_id: d.id, url: d.url })));
} finally { await db.$disconnect(); }
