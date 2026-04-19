/**
 * Seed the minimum data needed for a usable dev environment:
 *   - All four roles (idempotent upsert).
 *   - One admin account: admin@khohoc.online / Admin@12345
 *   - One teacher account: teacher@khohoc.online / Teacher@12345
 *   - One student account: student@khohoc.online / Student@12345
 *
 * Run with:  pnpm --filter api-core exec prisma db seed
 *
 * NEVER run this script in production. It ships hard-coded credentials.
 */
import { PrismaClient, RoleName, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function upsertRoles() {
  const names: RoleName[] = ['student', 'teacher', 'admin', 'ai_engine'];
  for (const name of names) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

async function upsertUser(
  email: string,
  displayName: string,
  password: string,
  roleName: RoleName,
) {
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      displayName,
      passwordHash,
      locale: 'vi',
      status: UserStatus.active,
    },
  });

  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) throw new Error(`Role not found: ${roleName}`);

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
}

async function main() {
  console.warn('[seed] upserting roles');
  await upsertRoles();

  console.warn('[seed] upserting admin / teacher / student accounts');
  await upsertUser('admin@khohoc.online', 'Admin User', 'Admin@12345', 'admin');
  await upsertUser('teacher@khohoc.online', 'Teacher Demo', 'Teacher@12345', 'teacher');
  await upsertUser('student@khohoc.online', 'Student Demo', 'Student@12345', 'student');

  console.warn('[seed] done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
