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

/**
 * Initial Knowledge Graph vocabulary. Teachers tag lessons against these
 * slugs; data-science updates user_mastery keyed by slug. Keep the list
 * short and opinionated — v1 covers foundational C++ concepts only. Add
 * more when P5c dashboards reveal what's missing.
 */
const KNOWLEDGE_NODES: Array<{ slug: string; title: string; domain: string }> = [
  // cpp-core
  { slug: 'io-basics',       title: 'Nhập xuất cơ bản (cin/cout)',  domain: 'cpp' },
  { slug: 'variables-types', title: 'Biến và kiểu dữ liệu',         domain: 'cpp' },
  { slug: 'operators',       title: 'Toán tử và biểu thức',         domain: 'cpp' },
  { slug: 'control-flow',    title: 'Rẽ nhánh (if/else, switch)',   domain: 'cpp' },
  { slug: 'loops',           title: 'Vòng lặp (for/while)',         domain: 'cpp' },
  { slug: 'functions',       title: 'Hàm và tham số',               domain: 'cpp' },
  { slug: 'arrays',          title: 'Mảng một chiều',               domain: 'cpp' },
  { slug: 'strings',         title: 'Chuỗi ký tự',                  domain: 'cpp' },
  { slug: 'pointers',        title: 'Con trỏ và tham chiếu',        domain: 'cpp' },
  { slug: 'recursion',       title: 'Đệ quy',                       domain: 'cpp' },
  // oop
  { slug: 'oop-basics',       title: 'OOP: lớp và đối tượng',       domain: 'cpp' },
  { slug: 'oop-inheritance',  title: 'OOP: kế thừa + đa hình',      domain: 'cpp' },
  // algo + ds
  { slug: 'algo-sorting',    title: 'Thuật toán sắp xếp',           domain: 'algo' },
  { slug: 'algo-searching',  title: 'Thuật toán tìm kiếm',          domain: 'algo' },
  { slug: 'ds-stack-queue',  title: 'Stack và Queue',               domain: 'ds'   },
];

/**
 * Directed prerequisite edges — "A is a prerequisite for B". Used by P5c
 * next-lesson suggestion: when student_mastery(A) < 0.5, we don't let B
 * surface as a suggestion yet.
 */
const KNOWLEDGE_PREREQS: Array<[string, string]> = [
  ['io-basics',       'variables-types'],
  ['variables-types', 'operators'],
  ['operators',       'control-flow'],
  ['control-flow',    'loops'],
  ['loops',           'functions'],
  ['functions',       'arrays'],
  ['arrays',          'strings'],
  ['arrays',          'pointers'],
  ['pointers',        'recursion'],
  ['functions',       'oop-basics'],
  ['oop-basics',      'oop-inheritance'],
  ['arrays',          'algo-sorting'],
  ['arrays',          'algo-searching'],
  ['arrays',          'ds-stack-queue'],
];

async function seedKnowledgeGraph(): Promise<void> {
  for (const n of KNOWLEDGE_NODES) {
    await prisma.knowledgeNode.upsert({
      where: { slug: n.slug },
      update: { title: n.title, domain: n.domain },
      create: n,
    });
  }
  for (const [fromSlug, toSlug] of KNOWLEDGE_PREREQS) {
    const from = await prisma.knowledgeNode.findUnique({ where: { slug: fromSlug } });
    const to = await prisma.knowledgeNode.findUnique({ where: { slug: toSlug } });
    if (!from || !to) continue;
    await prisma.knowledgeEdge.upsert({
      where: {
        fromId_toId_relation: { fromId: from.id, toId: to.id, relation: 'prereq' },
      },
      update: {},
      create: { fromId: from.id, toId: to.id, relation: 'prereq', weight: 1 },
    });
  }
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

  console.warn('[seed] seeding knowledge graph (15 nodes, 14 prereq edges)');
  await seedKnowledgeGraph();

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
