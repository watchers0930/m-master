// prisma/seed.ts — 초기 관리자 계정 시드
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@minteq.app';
  const password = process.env.ADMIN_PASSWORD || 'changeme123!';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name: 'Admin',
      passwordHash,
      plan: 'pro',
    },
  });

  // 기본 설정 생성
  await prisma.setting.create({
    data: {
      ownerId: user.id,
      brandGuide: {},
      promptTemplates: {},
      budgetMonthly: 500000,
      alertThreshold: 0.8,
      notifications: {},
    },
  });

  console.log(`Admin user created: ${email} (id: ${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
