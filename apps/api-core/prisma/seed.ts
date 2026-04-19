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

async function seedDemoCourse(): Promise<void> {
  const teacher = await prisma.user.findUnique({ where: { email: 'teacher@khohoc.online' } });
  if (!teacher) throw new Error('teacher seed missing');

  // Idempotent: skip if the slug already exists.
  const existing = await prisma.course.findUnique({ where: { slug: 'cpp-from-zero' } });
  if (existing) {
    console.warn('[seed] demo course already present — skipping');
    return;
  }

  const course = await prisma.course.create({
    data: {
      slug: 'cpp-from-zero',
      title: 'C++ từ căn bản đến nâng cao',
      description:
        'Lộ trình C++ thực hành với AI Tutor, tập trung giải thuật, cấu trúc dữ liệu và lập trình thi đấu.',
      teacherId: teacher.id,
      status: 'published',
      pricingModel: 'free',
      coverUrl: null,
      locale: 'vi',
      publishedAt: new Date(),
      modules: {
        create: [
          {
            title: 'Khởi động',
            sortOrder: 1,
            lessons: {
              create: [
                {
                  title: 'Chào mừng đến với C++',
                  sortOrder: 1,
                  type: 'markdown',
                  estMinutes: 8,
                  contentMarkdown: [
                    '# Chào mừng đến với C++',
                    '',
                    'Trong khoá này bạn sẽ học C++ bằng cách gõ — không video, không lý thuyết suông.',
                    '',
                    'Mỗi bài gồm một đoạn lý thuyết ngắn + một bài tập code chạy trong sandbox. AI Tutor sẽ nhảy vào khi bạn gặp lỗi biên dịch.',
                    '',
                    '**Yêu cầu:** không cần cài đặt gì — trình biên dịch chạy trên server.',
                  ].join('\n'),
                },
                {
                  title: 'Hello, world!',
                  sortOrder: 2,
                  type: 'exercise',
                  estMinutes: 5,
                  contentMarkdown: [
                    '## Nhiệm vụ',
                    '',
                    'Viết chương trình C++ in ra dòng chữ `Hello, world!` (không xuống dòng).',
                    '',
                    'Bấm **Run** để kiểm tra — sandbox sẽ so sánh output của bạn với kết quả mong đợi.',
                  ].join('\n'),
                  exercise: {
                    create: {
                      language: 'cpp',
                      starterCode: [
                        '#include <iostream>',
                        '',
                        'int main() {',
                        '    // TODO: in ra "Hello, world!"',
                        '    return 0;',
                        '}',
                      ].join('\n'),
                      solutionCode: [
                        '#include <iostream>',
                        'int main() { std::cout << "Hello, world!"; return 0; }',
                      ].join('\n'),
                      testCases: {
                        create: [
                          { input: '', expectedOutput: 'Hello, world!', isSample: true, weight: 1 },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });

  console.warn(`[seed] demo course created: ${course.slug}`);
}

async function main() {
  console.warn('[seed] upserting roles');
  await upsertRoles();

  console.warn('[seed] upserting admin / teacher / student accounts');
  await upsertUser('admin@khohoc.online', 'Admin User', 'Admin@12345', 'admin');
  await upsertUser('teacher@khohoc.online', 'Teacher Demo', 'Teacher@12345', 'teacher');
  await upsertUser('student@khohoc.online', 'Student Demo', 'Student@12345', 'student');

  console.warn('[seed] seeding demo course');
  await seedDemoCourse();

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
