#!/usr/bin/env npx tsx
// scripts/ga4/bind.ts — GA4 바인딩 운영자 CLI (설계 §4.11·B6). HTTP로 노출하지 않는다:
// 공유 서비스 계정에 테넌트가 임의 속성을 묶지 못하도록 바인딩은 운영자만 만든다.
//
// 조회(읽기 전용):  npx tsx scripts/ga4/bind.ts --list --owner <ownerId>
// 바인딩/갱신:      npx tsx scripts/ga4/bind.ts --owner <ownerId> --domain <domainId> --property <숫자> \
//                     [--stream <숫자>] [--sources service_account,owner_oauth] [--events form_submit,...] [--verify] [--disable]
// env: .env.local (DB 연결 · GA4_SERVICE_ACCOUNT_JSON 등). 값은 출력하지 않는다.
import { config } from 'dotenv';
import { parseArgs } from 'node:util';
config({ path: '.env.local' });

const csv = (value?: string) => value === undefined ? undefined : value.split(',').map(v => v.trim()).filter(Boolean);

async function list(ownerId: string) {
  // Imported after dotenv so lib/prisma sees the DB URL.
  const { prisma } = await import('@/lib/prisma');
  const [domains, bindings] = await Promise.all([
    prisma.domain.findMany({ where: { ownerId }, select: { id: true, url: true, market: true }, orderBy: { id: 'asc' }, take: 200 }),
    prisma.ga4Binding.findMany({ where: { ownerId }, orderBy: { id: 'asc' }, take: 200, select: { id: true, domainId: true, host: true,
      propertyId: true, streamId: true, status: true, allowedSources: true, conversionEvents: true, lastErrorCode: true, lastCheckedAt: true } }),
  ]);
  console.log(`[ga4:bind] owner ${ownerId} — 도메인 ${domains.length}개`);
  console.table(domains);
  console.log(`[ga4:bind] 바인딩 ${bindings.length}개`);
  console.table(bindings.map(b => ({ ...b, allowedSources: b.allowedSources.join(','), conversionEvents: b.conversionEvents.join(','),
    lastCheckedAt: b.lastCheckedAt?.toISOString() ?? null })));
  await prisma.$disconnect();
}

async function bind(values: Record<string, string | boolean | undefined>) {
  const { bindGa4 } = await import('@/lib/ga4/binding');
  const { prisma } = await import('@/lib/prisma');
  // bindGa4 validates strictly with zod (owner/domain/property/stream/sources/events).
  const { bindingId } = await bindGa4({ owner: values.owner, domain: values.domain, property: values.property,
    ...(values.stream !== undefined ? { stream: values.stream } : {}),
    ...(values.sources !== undefined ? { sources: csv(values.sources as string) } : {}),
    ...(values.events !== undefined ? { events: csv(values.events as string) } : {}),
    verify: !!values.verify, disable: !!values.disable });
  const saved = await prisma.ga4Binding.findFirst({ where: { id: bindingId, ownerId: values.owner as string },
    select: { id: true, host: true, propertyId: true, streamId: true, status: true, lastErrorCode: true } });
  console.log('[ga4:bind] 저장됨', saved);
  if (!values.verify && !values.disable) console.log('[ga4:bind] status=pending — 실호출 확인은 --verify 로 다시 실행하세요.');
  await prisma.$disconnect();
}

async function main() {
  const { values } = parseArgs({ strict: true, options: {
    owner: { type: 'string' }, domain: { type: 'string' }, property: { type: 'string' }, stream: { type: 'string' },
    sources: { type: 'string' }, events: { type: 'string' }, verify: { type: 'boolean' }, disable: { type: 'boolean' }, list: { type: 'boolean' },
  } });
  if (!values.owner) throw new Error('--owner 가 필요합니다.');
  if (values.list) return list(values.owner);
  if (!values.domain || !values.property) throw new Error('--domain 과 --property 가 필요합니다 (조회는 --list).');
  return bind(values);
}

main().catch((error: unknown) => {
  // Error class/message only (zod issues or our codes) — never env values or credentials.
  const name = error instanceof Error ? error.name : 'unknown';
  const message = error && typeof error === 'object' && 'issues' in error ? JSON.stringify((error as { issues: unknown }).issues)
    : error instanceof Error ? error.message : '';
  console.error(`[ga4:bind] 실패 (${name}) ${message}`);
  process.exit(1);
});
