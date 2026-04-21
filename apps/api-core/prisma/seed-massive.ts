/**
 * Massive demo seed (P9.0) — fills the pilot DB with enough synthetic data
 * that the P9 analytics surfaces (Classroom Heatmap, Dropout Alert,
 * Skill Radar, Collaborative Filtering) have signal at demo time.
 *
 * Produces:
 *   - 1 teacher account `mass-teacher@demo.khohoc.online` (owns all demo
 *     courses so the main Studio belongs to `teacher@khohoc.online`)
 *   - 20 courses (slug prefix `demo-`) across cpp / python / algo / web
 *   - 500 virtual students with the email pattern
 *     `massive-student-NNNN@demo.khohoc.online`
 *   - 2 000 random enrolments (≈4 courses per student)
 *   - ≈50 000 submissions spread over the last 45 days, with verdict
 *     distributions driven by a per-student archetype
 *   - user_mastery rows directly inserted for every (student × relevant
 *     knowledge node) pair — we skip the data-science BKT rebuild
 *     (500 × ~2s per user > 15 min) and derive a BKT-shaped score from
 *     the student's AC rate on that node instead. Same shape, same UI.
 *
 * Run:
 *   pnpm --filter api-core exec ts-node --transpile-only prisma/seed-massive.ts
 *   pnpm --filter api-core exec ts-node --transpile-only prisma/seed-massive.ts -- --force
 *
 * Idempotent: detects a sentinel user and bails out unless `--force` is
 * passed, in which case all `@demo.khohoc.online` users and `demo-*`
 * courses are removed first (cascades wipe their submissions/mastery too).
 *
 * NEVER run in production — these accounts ship a shared trivial password.
 */
/* eslint-disable no-console */
import {
  PrismaClient,
  type CodeLanguage,
  type LessonType,
  type Verdict,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

const NUM_STUDENTS = 500;
const TARGET_SUBMISSIONS = 50_000;
const ENROLMENTS_PER_STUDENT_MIN = 3;
const ENROLMENTS_PER_STUDENT_MAX = 6;
const SUBMISSION_WINDOW_DAYS = 45;
const BATCH_SIZE = 5_000;
const SHARED_PASSWORD = 'Demo@12345';

// ---------------------------------------------------------------------------
// Deterministic-ish RNG (xorshift32) — keeps seeded data reproducible across
// runs on the same machine and readable in review diffs.
// ---------------------------------------------------------------------------

let rngState = 0xdeadbeef;
function rand(): number {
  let x = rngState | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rngState = x | 0;
  return ((x >>> 0) % 1_000_000) / 1_000_000;
}
const randInt = (lo: number, hi: number) => Math.floor(rand() * (hi - lo + 1)) + lo;
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

// ---------------------------------------------------------------------------
// Course catalog (20 courses). `nodes` lists the knowledge-node slugs each
// course exercises — must exist in the main seed's KNOWLEDGE_NODES list or
// be added via the `extraNodes` block below.
// ---------------------------------------------------------------------------

interface CourseSpec {
  slug: string;
  title: string;
  description: string;
  locale: 'vi' | 'en';
  language: CodeLanguage;
  nodes: string[];
  pricingModel: 'free' | 'paid';
  priceVnd?: number;
}

const COURSES: CourseSpec[] = [
  { slug: 'demo-cpp-basics',       title: 'C++ cơ bản — Từ cú pháp tới vòng lặp', description: 'Nền móng C++: biến, toán tử, điều kiện, vòng lặp — bài tập sandbox liên tục.', locale: 'vi', language: 'cpp', nodes: ['io-basics', 'variables-types', 'operators', 'control-flow', 'loops'], pricingModel: 'free' },
  { slug: 'demo-cpp-functions',    title: 'Hàm và Mảng trong C++',                description: 'Học cách viết hàm sạch, truyền tham số và làm việc với mảng một chiều.',        locale: 'vi', language: 'cpp', nodes: ['functions', 'arrays'], pricingModel: 'free' },
  { slug: 'demo-cpp-pointers',     title: 'Con trỏ & Tham chiếu C++',              description: 'Con trỏ là tảng đá — vượt qua là C++ mở cửa hoàn toàn.',                      locale: 'vi', language: 'cpp', nodes: ['pointers', 'arrays', 'strings'], pricingModel: 'paid', priceVnd: 199_000 },
  { slug: 'demo-cpp-recursion',    title: 'Đệ quy & Tư duy chia để trị',           description: 'Đệ quy qua 20 ví dụ thực tế, từ Fibonacci tới quét mê cung.',                 locale: 'vi', language: 'cpp', nodes: ['recursion', 'functions'], pricingModel: 'paid', priceVnd: 149_000 },
  { slug: 'demo-cpp-oop',          title: 'OOP với C++',                           description: 'Lớp, đối tượng, kế thừa, đa hình — case study quản lý thư viện.',            locale: 'vi', language: 'cpp', nodes: ['oop-basics', 'oop-inheritance', 'functions'], pricingModel: 'paid', priceVnd: 249_000 },
  { slug: 'demo-cpp-stl',          title: 'STL thực chiến',                        description: 'vector, map, set, algorithm — dùng đúng STL để code ngắn gấp 3.',            locale: 'vi', language: 'cpp', nodes: ['arrays', 'strings', 'ds-stack-queue'], pricingModel: 'paid', priceVnd: 199_000 },

  { slug: 'demo-algo-sorting',     title: 'Thuật toán sắp xếp từ A đến Z',         description: 'Bubble, merge, quick, heap — cả độ phức tạp và khi nào dùng gì.',             locale: 'vi', language: 'cpp', nodes: ['algo-sorting', 'arrays'], pricingModel: 'paid', priceVnd: 249_000 },
  { slug: 'demo-algo-searching',   title: 'Tìm kiếm tuyến tính & nhị phân',        description: 'Binary search bẻ khoá chục bài phỏng vấn — làm chuẩn một lần, nhớ cả đời.', locale: 'vi', language: 'cpp', nodes: ['algo-searching', 'arrays', 'loops'], pricingModel: 'free' },
  { slug: 'demo-algo-dp-intro',    title: 'Quy hoạch động nhập môn',               description: 'Tiếp cận DP qua 10 bài cổ điển: coin change, LIS, knapsack.',                 locale: 'vi', language: 'cpp', nodes: ['recursion', 'arrays', 'algo-sorting'], pricingModel: 'paid', priceVnd: 299_000 },
  { slug: 'demo-algo-graph',       title: 'Đồ thị & BFS/DFS',                      description: 'Làm chủ biểu diễn đồ thị, BFS, DFS, và bài toán shortest path.',              locale: 'vi', language: 'cpp', nodes: ['recursion', 'ds-stack-queue'], pricingModel: 'paid', priceVnd: 249_000 },
  { slug: 'demo-ds-stack-queue',   title: 'Stack, Queue và ứng dụng',              description: 'Từ khung thuật toán tới parser biểu thức.',                                    locale: 'vi', language: 'cpp', nodes: ['ds-stack-queue', 'arrays'], pricingModel: 'free' },

  { slug: 'demo-python-intro',     title: 'Python cho người bắt đầu',              description: 'Cú pháp Python, list, dictionary, hàm, đọc ghi file.',                        locale: 'vi', language: 'python', nodes: ['io-basics', 'variables-types', 'control-flow', 'loops', 'functions'], pricingModel: 'free' },
  { slug: 'demo-python-data',      title: 'Python cho phân tích dữ liệu',          description: 'pandas, matplotlib, numpy — làm project EDA đầu tay.',                         locale: 'vi', language: 'python', nodes: ['arrays', 'functions', 'loops'], pricingModel: 'paid', priceVnd: 349_000 },
  { slug: 'demo-python-web',       title: 'Flask & REST API',                       description: 'Xây REST API đầu tiên với Flask + SQLite + testing.',                          locale: 'vi', language: 'python', nodes: ['functions', 'strings'], pricingModel: 'paid', priceVnd: 299_000 },

  { slug: 'demo-js-basics',        title: 'JavaScript hiện đại',                    description: 'ES6+, const/let, arrow, async — nền tảng cho React/Node.',                    locale: 'vi', language: 'js', nodes: ['io-basics', 'variables-types', 'control-flow', 'loops', 'functions'], pricingModel: 'free' },
  { slug: 'demo-js-dom',           title: 'Tương tác DOM & Event',                  description: 'Thao tác DOM tinh gọn và xử lý event không cần framework.',                     locale: 'vi', language: 'js', nodes: ['functions', 'strings'], pricingModel: 'paid', priceVnd: 199_000 },
  { slug: 'demo-js-async',         title: 'Async/Await trong JavaScript',           description: 'Callback → Promise → async/await, Promise.all, error handling.',               locale: 'vi', language: 'js', nodes: ['functions', 'recursion'], pricingModel: 'paid', priceVnd: 249_000 },

  { slug: 'demo-interview-prep',   title: 'Tuyển tập 50 bài phỏng vấn C++',         description: 'Array, string, tree, graph — mọi công ty tech đều hỏi một biến thể.',          locale: 'vi', language: 'cpp', nodes: ['arrays', 'strings', 'algo-sorting', 'algo-searching', 'recursion'], pricingModel: 'paid', priceVnd: 399_000 },
  { slug: 'demo-code-smell',       title: 'Clean Code với ví dụ C++',               description: 'Refactor một codebase 1 000 LOC thành clean — tránh 10 code smell hay gặp.',   locale: 'vi', language: 'cpp', nodes: ['functions', 'oop-basics'], pricingModel: 'paid', priceVnd: 249_000 },
  { slug: 'demo-english-prog',     title: 'Intro to Programming in C++',            description: 'English-taught entry into programming — variables, control flow, functions.',   locale: 'en', language: 'cpp', nodes: ['io-basics', 'variables-types', 'control-flow', 'loops', 'functions'], pricingModel: 'free' },
];

// ---------------------------------------------------------------------------
// Archetypes — each student picks one at creation; all their submissions use
// that archetype's AC rate + preferred domain bias.
// ---------------------------------------------------------------------------

interface Archetype {
  name: string;
  weight: number;              // population share
  acRate: number;              // baseline pass rate
  activityMultiplier: number;  // relative submission volume
  preferDomain?: CodeLanguage; // biased to exercises in this language
}

const ARCHETYPES: Archetype[] = [
  { name: 'absolute-beginner', weight: 0.22, acRate: 0.28, activityMultiplier: 0.7 },
  { name: 'steady-learner',    weight: 0.35, acRate: 0.58, activityMultiplier: 1.0 },
  { name: 'strong-performer',  weight: 0.15, acRate: 0.85, activityMultiplier: 1.3 },
  { name: 'cpp-focused',       weight: 0.12, acRate: 0.70, activityMultiplier: 1.1, preferDomain: 'cpp' },
  { name: 'python-focused',    weight: 0.10, acRate: 0.68, activityMultiplier: 1.1, preferDomain: 'python' },
  { name: 'drop-risk',         weight: 0.06, acRate: 0.22, activityMultiplier: 0.4 },
];

function pickArchetype(): Archetype {
  const r = rand();
  let cum = 0;
  for (const a of ARCHETYPES) {
    cum += a.weight;
    if (r <= cum) return a;
  }
  return ARCHETYPES[ARCHETYPES.length - 1]!;
}

// ---------------------------------------------------------------------------
// Verdict distribution — when an archetype "passes" we emit AC; when they
// don't, we spread the failure across WA/CE/TLE/RE in realistic proportions.
// ---------------------------------------------------------------------------

const FAIL_MIX: Array<[Verdict, number]> = [
  ['wa', 0.55],
  ['ce', 0.20],
  ['tle', 0.15],
  ['re', 0.10],
];

function pickVerdict(acRate: number): Verdict {
  if (rand() < acRate) return 'ac';
  const r = rand();
  let cum = 0;
  for (const [v, w] of FAIL_MIX) {
    cum += w;
    if (r <= cum) return v;
  }
  return 'wa';
}

// ---------------------------------------------------------------------------
// Placeholder source code — kept short so 50k rows stay under ~5 MB. Each
// submission carries a comment with its sequence number so it's not a
// duplicated blob in the DB (helps pg_dump stay useful, makes grep possible).
// ---------------------------------------------------------------------------

function placeholderSource(language: CodeLanguage, seq: number): string {
  switch (language) {
    case 'cpp':
    case 'c':
      return `// seed-massive submission #${seq}\n#include <iostream>\nint main() { std::cout << "demo"; return 0; }\n`;
    case 'python':
      return `# seed-massive submission #${seq}\nprint("demo")\n`;
    case 'js':
      return `// seed-massive submission #${seq}\nconsole.log("demo");\n`;
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function ensureTeacher(): Promise<string> {
  const email = 'mass-teacher@demo.khohoc.online';
  const hash = await argon2.hash(SHARED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const teacher = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      displayName: 'Demo Teacher (seed-massive)',
      passwordHash: hash,
      locale: 'vi',
      status: 'active',
    },
  });
  const role = await prisma.role.findUnique({ where: { name: 'teacher' } });
  if (!role) throw new Error('role teacher missing — run `pnpm db:seed` first');
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: teacher.id, roleId: role.id } },
    update: {},
    create: { userId: teacher.id, roleId: role.id },
  });
  return teacher.id;
}

interface SeededExercise {
  id: string;
  courseId: string;
  courseSlug: string;
  language: CodeLanguage;
  lessonId: string;
  nodeIds: string[];
}

async function seedCourses(teacherId: string): Promise<SeededExercise[]> {
  const allExercises: SeededExercise[] = [];
  const nodeSlugToId = new Map<string, string>();
  for (const n of await prisma.knowledgeNode.findMany()) nodeSlugToId.set(n.slug, n.id);

  for (const spec of COURSES) {
    const course = await prisma.course.upsert({
      where: { slug: spec.slug },
      update: { title: spec.title, description: spec.description, status: 'published' },
      create: {
        slug: spec.slug,
        title: spec.title,
        description: spec.description,
        teacherId,
        locale: spec.locale,
        status: 'published',
        publishedAt: new Date(),
        pricingModel: spec.pricingModel,
        priceCents: spec.pricingModel === 'paid' ? (spec.priceVnd ?? 199_000) * 100 : null,
        currency: spec.pricingModel === 'paid' ? 'VND' : null,
      },
    });

    // Blow away any stale modules so a re-seed produces clean state.
    await prisma.module.deleteMany({ where: { courseId: course.id } });

    const numModules = 3 + Math.floor(rand() * 2); // 3 or 4
    for (let mi = 0; mi < numModules; mi++) {
      const mod = await prisma.module.create({
        data: {
          courseId: course.id,
          title: `Chương ${mi + 1}`,
          sortOrder: mi,
        },
      });

      const numLessons = 4 + Math.floor(rand() * 3); // 4–6 lessons
      for (let li = 0; li < numLessons; li++) {
        const isExercise = rand() < 0.65; // 65% exercises
        const type: LessonType = isExercise ? 'exercise' : 'markdown';
        const lesson = await prisma.lesson.create({
          data: {
            moduleId: mod.id,
            title: `${spec.title.split(' —')[0]} · bài ${mi + 1}.${li + 1}`,
            sortOrder: li,
            type,
            contentMarkdown: `Bài ${mi + 1}.${li + 1} — nội dung lý thuyết ngắn cho ${spec.title}.`,
            estMinutes: 8 + Math.floor(rand() * 8),
          },
        });

        // Tag each lesson with 1–2 knowledge nodes from this course's slate.
        const pickNodes = Math.min(spec.nodes.length, 1 + Math.floor(rand() * 2));
        const chosenSlugs = new Set<string>();
        while (chosenSlugs.size < pickNodes) chosenSlugs.add(pick(spec.nodes));
        const nodeIds = [...chosenSlugs]
          .map((s) => nodeSlugToId.get(s))
          .filter((x): x is string => Boolean(x));
        if (nodeIds.length > 0) {
          await prisma.lessonKnowledgeNode.createMany({
            data: nodeIds.map((nodeId) => ({ lessonId: lesson.id, nodeId })),
            skipDuplicates: true,
          });
        }

        if (isExercise) {
          const ex = await prisma.exercise.create({
            data: {
              lessonId: lesson.id,
              language: spec.language,
              starterCode: placeholderSource(spec.language, 0),
              solutionCode: placeholderSource(spec.language, 0),
              testCases: {
                create: [
                  { input: '', expectedOutput: 'demo', isSample: true, weight: 1 },
                ],
              },
            },
          });
          allExercises.push({
            id: ex.id,
            courseId: course.id,
            courseSlug: spec.slug,
            language: spec.language,
            lessonId: lesson.id,
            nodeIds,
          });
        }
      }
    }
  }

  return allExercises;
}

interface StudentRow {
  id: string;
  email: string;
  archetypeIdx: number;
}

async function seedStudents(): Promise<StudentRow[]> {
  const role = await prisma.role.findUnique({ where: { name: 'student' } });
  if (!role) throw new Error('role student missing — run `pnpm db:seed` first');

  // Argon2 is expensive (~300ms/hash). For 500 throwaway demo accounts we
  // hash the shared password exactly once and reuse the string.
  const sharedHash = await argon2.hash(SHARED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const rows: StudentRow[] = [];
  const batchSize = 200;

  for (let start = 0; start < NUM_STUDENTS; start += batchSize) {
    const batch: Array<Parameters<typeof prisma.user.create>[0]['data']> = [];
    const archetypeIndices: number[] = [];
    for (let i = 0; i < batchSize && start + i < NUM_STUDENTS; i++) {
      const n = start + i;
      const archetype = pickArchetype();
      archetypeIndices.push(ARCHETYPES.indexOf(archetype));
      const email = `massive-student-${String(n + 1).padStart(4, '0')}@demo.khohoc.online`;
      batch.push({
        email,
        displayName: `Demo student ${String(n + 1).padStart(4, '0')} · ${archetype.name}`,
        passwordHash: sharedHash,
        locale: 'vi',
        status: 'active',
      });
    }
    // createMany returns counts, not rows — we need IDs so fall back to
    // per-row creates but run them in parallel with a bounded pool. 200
    // parallel inserts fit comfortably in Postgres's connection budget.
    const created = await Promise.all(batch.map((data) => prisma.user.create({ data })));
    for (let i = 0; i < created.length; i++) {
      rows.push({
        id: created[i]!.id,
        email: created[i]!.email,
        archetypeIdx: archetypeIndices[i]!,
      });
    }
  }

  // Grant student role in one bulk call.
  await prisma.userRole.createMany({
    data: rows.map((r) => ({ userId: r.id, roleId: role.id })),
    skipDuplicates: true,
  });

  return rows;
}

async function seedEnrolments(
  students: StudentRow[],
  exercises: SeededExercise[],
): Promise<Map<string, string[]>> {
  const coursesById = new Map<string, { id: string; language: CodeLanguage }>();
  for (const ex of exercises) {
    coursesById.set(ex.courseId, { id: ex.courseId, language: ex.language });
  }
  const allCourseIds = [...coursesById.keys()];
  const studentToCourses = new Map<string, string[]>();

  const data: Array<{ userId: string; courseId: string; enrolledAt: Date }> = [];
  for (const s of students) {
    const n = randInt(ENROLMENTS_PER_STUDENT_MIN, ENROLMENTS_PER_STUDENT_MAX);
    const shuffled = [...allCourseIds].sort(() => rand() - 0.5).slice(0, n);
    studentToCourses.set(s.id, shuffled);
    const enrolledAt = new Date(Date.now() - randInt(10, 60) * 24 * 60 * 60 * 1000);
    for (const courseId of shuffled) data.push({ userId: s.id, courseId, enrolledAt });
  }

  // createMany chokes at ~65k rows; we stay well under so single call is fine.
  await prisma.enrollment.createMany({ data, skipDuplicates: true });
  return studentToCourses;
}

async function seedSubmissions(
  students: StudentRow[],
  exercises: SeededExercise[],
  studentToCourses: Map<string, string[]>,
): Promise<void> {
  const exercisesByCourse = new Map<string, SeededExercise[]>();
  for (const ex of exercises) {
    if (!exercisesByCourse.has(ex.courseId)) exercisesByCourse.set(ex.courseId, []);
    exercisesByCourse.get(ex.courseId)!.push(ex);
  }

  // Precompute how many submissions each student gets so the total hits
  // TARGET_SUBMISSIONS after archetype-activity weighting.
  const weights = students.map((s) => ARCHETYPES[s.archetypeIdx]!.activityMultiplier);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const perStudent = weights.map((w) => Math.max(5, Math.round((w / totalWeight) * TARGET_SUBMISSIONS)));

  const now = Date.now();
  const windowMs = SUBMISSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  let buffer: Array<{
    userId: string;
    exerciseId: string;
    sourceCode: string;
    language: CodeLanguage;
    verdict: Verdict;
    runtimeMs: number;
    createdAt: Date;
    finishedAt: Date;
  }> = [];
  let globalSeq = 0;
  let inserted = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    await prisma.submission.createMany({ data: buffer });
    inserted += buffer.length;
    buffer = [];
    process.stdout.write(`  submissions: ${inserted}\r`);
  };

  for (let si = 0; si < students.length; si++) {
    const student = students[si]!;
    const archetype = ARCHETYPES[student.archetypeIdx]!;
    const enrolledCourseIds = studentToCourses.get(student.id) ?? [];
    const candidateExercises = enrolledCourseIds.flatMap((cid) => exercisesByCourse.get(cid) ?? []);
    if (candidateExercises.length === 0) continue;

    const n = perStudent[si]!;
    for (let k = 0; k < n; k++) {
      // Domain bias: if archetype prefers a language and there's at least
      // one matching exercise among enrolments, flip a weighted coin.
      let ex = pick(candidateExercises);
      if (archetype.preferDomain) {
        const matching = candidateExercises.filter((e) => e.language === archetype.preferDomain);
        if (matching.length > 0 && rand() < 0.65) ex = pick(matching);
      }
      const verdict = pickVerdict(archetype.acRate);
      const createdAt = new Date(now - Math.floor(rand() * windowMs));
      // finishedAt is createdAt + 0.3–4 seconds; keeps "time to grade"
      // charts honest if/when we build them.
      const finishedAt = new Date(createdAt.getTime() + 300 + Math.floor(rand() * 3_700));
      const runtimeMs = verdict === 'tle' ? 3_000 : 30 + Math.floor(rand() * 500);
      globalSeq += 1;
      buffer.push({
        userId: student.id,
        exerciseId: ex.id,
        sourceCode: placeholderSource(ex.language, globalSeq),
        language: ex.language,
        verdict,
        runtimeMs,
        createdAt,
        finishedAt,
      });
      if (buffer.length >= BATCH_SIZE) await flush();
    }
  }
  await flush();
  process.stdout.write('\n');
}

async function seedMastery(students: StudentRow[]): Promise<void> {
  // Instead of calling data-science rebuild 500× (~15 min), we compute a
  // BKT-shaped score directly from each student's AC rate on each
  // knowledge node. Matches the distribution BKT would produce closely
  // enough for UI demos — Heatmap, Radar, and Explainable rec cards all
  // consume the user_mastery rows without caring who wrote them.
  console.warn('[massive] computing mastery from submissions');
  const rows: Array<{
    user_id: string;
    node_id: string;
    passed: boolean;
  }> = await prisma.$queryRaw`
    SELECT s.user_id, l_kn.node_id, (s.verdict = 'ac') AS passed
      FROM submissions s
      JOIN exercises e ON e.id = s.exercise_id
      JOIN lessons l ON l.id = e.lesson_id
      JOIN lesson_knowledge_nodes l_kn ON l_kn.lesson_id = l.id
     WHERE s.user_id = ANY(${students.map((s) => s.id)}::uuid[])
  `;

  interface Bucket {
    pass: number;
    fail: number;
  }
  const bucket = new Map<string, Bucket>(); // key = `${user}:${node}`
  for (const r of rows) {
    const k = `${r.user_id}:${r.node_id}`;
    const b = bucket.get(k) ?? { pass: 0, fail: 0 };
    if (r.passed) b.pass++;
    else b.fail++;
    bucket.set(k, b);
  }

  const masteryRows: Array<{
    userId: string;
    nodeId: string;
    score: number;
    confidence: number;
    attempts: number;
  }> = [];
  for (const [key, b] of bucket) {
    const [userId, nodeId] = key.split(':') as [string, string];
    const attempts = b.pass + b.fail;
    // BKT-like shape: clamp to [0.05, 0.95], add a touch of jitter so the
    // heatmap isn't visually banded. Score tracks AC rate.
    const raw = attempts > 0 ? b.pass / attempts : 0.1;
    const jitter = (rand() - 0.5) * 0.08;
    const score = Math.max(0.05, Math.min(0.95, raw + jitter));
    const confidence = attempts / (attempts + 5);
    masteryRows.push({ userId, nodeId, score, confidence, attempts });
  }

  // createMany doesn't support composite-PK upsert; wipe first, then insert.
  await prisma.userMastery.deleteMany({
    where: { userId: { in: students.map((s) => s.id) } },
  });
  for (let i = 0; i < masteryRows.length; i += 2_000) {
    await prisma.userMastery.createMany({
      data: masteryRows.slice(i, i + 2_000),
      skipDuplicates: true,
    });
  }
  console.warn(`[massive] wrote ${masteryRows.length} mastery rows`);
}

async function wipePrevious(): Promise<void> {
  console.warn('[massive] --force: wiping previous massive seed');
  // Students first (cascade removes enrolments / submissions / mastery).
  const { count: userCount } = await prisma.user.deleteMany({
    where: { email: { endsWith: '@demo.khohoc.online' } },
  });
  // Then demo courses (cascade removes modules / lessons / exercises).
  const { count: courseCount } = await prisma.course.deleteMany({
    where: { slug: { startsWith: 'demo-' } },
  });
  console.warn(`[massive] wiped ${userCount} users + ${courseCount} courses`);
}

async function main() {
  const force = process.argv.includes('--force');
  const sentinel = await prisma.user.findUnique({
    where: { email: 'massive-student-0001@demo.khohoc.online' },
  });
  if (sentinel && !force) {
    console.warn('[massive] already seeded (sentinel exists). Pass --force to re-seed.');
    return;
  }
  if (sentinel && force) await wipePrevious();

  const started = Date.now();

  console.warn('[massive] ensuring demo teacher account');
  const teacherId = await ensureTeacher();

  console.warn(`[massive] seeding ${COURSES.length} courses`);
  const exercises = await seedCourses(teacherId);
  console.warn(`[massive] → ${exercises.length} exercises across ${COURSES.length} courses`);

  console.warn(`[massive] seeding ${NUM_STUDENTS} virtual students`);
  const students = await seedStudents();
  console.warn(`[massive] → ${students.length} students`);

  console.warn('[massive] enrolling students in 3–6 courses each');
  const studentToCourses = await seedEnrolments(students, exercises);

  console.warn(`[massive] generating ~${TARGET_SUBMISSIONS} submissions (45-day window)`);
  await seedSubmissions(students, exercises, studentToCourses);

  await seedMastery(students);

  const elapsed = ((Date.now() - started) / 1_000).toFixed(1);
  console.warn(`[massive] done in ${elapsed}s`);

  // Basic sanity counts for the commit log.
  const [uCount, sCount, mCount] = await Promise.all([
    prisma.user.count({ where: { email: { endsWith: '@demo.khohoc.online' } } }),
    prisma.submission.count(),
    prisma.userMastery.count(),
  ]);
  console.warn(`[massive] db totals: demo_users=${uCount} submissions=${sCount} mastery_rows=${mCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
