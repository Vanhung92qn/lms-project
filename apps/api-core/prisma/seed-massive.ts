/**
 * Massive demo seed (P9.0) — fills the pilot DB with enough synthetic data
 * that the P9 analytics surfaces (Classroom Heatmap, Dropout Alert,
 * Skill Radar, Collaborative Filtering) have signal at demo time.
 *
 * Produces:
 *   - 1 teacher account `mass-teacher@demo.khohoc.online` (owns all demo
 *     courses so the main Studio belongs to `teacher@khohoc.online`)
 *   - 20 courses (slug prefix `demo-`) across 3 flavours:
 *       · CONSOLIDATED HANDS-ON: 2 C++ tracks (Cơ bản / Nâng cao) with
 *         many lessons each, plus C / Python / JS
 *       · THEORY-ONLY (markdown + auto-gen quiz): HTML, CSS, Kỹ thuật
 *         phần mềm, Mạng máy tính, Cơ sở dữ liệu, Tư duy OOP, Tư duy
 *         giải thuật — feed the BKT engine via quiz_attempts, not code
 *       · APPLIED: DSA, Flask, DOM, interview prep, Clean Code
 *   - 500 virtual students with the email pattern
 *     `massive-student-NNNN@demo.khohoc.online`
 *   - 2 000+ random enrolments (3–6 courses per student)
 *   - ≈50 000 submissions over the last 45 days, verdict distributions
 *     driven by a per-student archetype
 *   - user_mastery rows directly inserted for every (student × relevant
 *     knowledge node) pair — we skip the data-science BKT rebuild
 *     (500 × ~2s per user > 15 min) and derive a BKT-shaped score from
 *     the student's AC rate on that node instead.
 *
 * Run:
 *   pnpm --filter api-core db:seed:massive
 *   pnpm --filter api-core db:seed:massive -- --force
 *
 * Idempotent: detects a sentinel user and bails unless `--force` is passed,
 * in which case every `@demo.khohoc.online` user and `demo-*` course is
 * removed first (cascades wipe their submissions, enrolments, mastery).
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
import { MongoClient } from 'mongodb';

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
// Course catalog — 20 courses designed for diversity:
//   · 2 C++ tracks (consolidated, many lessons each)
//   · C, Python (2), JS (2), HTML, CSS
//   · 5 theory-only courses (Kỹ thuật phần mềm, Mạng, DB, OOP, Giải thuật)
//   · 3 applied (DSA foundation, Interview prep, Clean Code, English intro)
//
// Each lesson is declared by a `topic` string; `lessonContent()` turns the
// topic into ~500-char Vietnamese markdown with embedded code blocks where
// the course has a language. Theory-only courses produce markdown-only
// lessons that flow through the auto-gen quiz pipeline (P9.0).
// ---------------------------------------------------------------------------

interface CourseSpec {
  slug: string;
  title: string;
  description: string;
  locale: 'vi' | 'en';
  language?: CodeLanguage; // omitted = theory-only (no exercises, quiz-gated)
  nodes: string[];
  pricingModel: 'free' | 'paid';
  priceVnd?: number;
  // Mark every exercise in this course as a `challenge` so it gets pulled
  // into the future /arena leaderboard zone. Hands-on advanced / DSA /
  // interview-style courses qualify; intro courses stay relaxed.
  challenge?: boolean;
  modules: Array<{
    title: string;
    lessons: string[]; // topic keywords, one per lesson
  }>;
}

const COURSES: CourseSpec[] = [
  // ---- C++ (consolidated: 2 deep courses) ---------------------------------
  {
    slug: 'demo-cpp-fundamentals',
    title: 'C++ Cơ bản — Từ zero đến thành thạo',
    description:
      'Khoá nền tảng C++ hoàn chỉnh: cú pháp, biến, điều kiện, vòng lặp, hàm, mảng, chuỗi, con trỏ. Học bằng cách gõ code — mỗi bài đều có sandbox chấm tự động.',
    locale: 'vi',
    language: 'cpp',
    pricingModel: 'free',
    nodes: ['io-basics', 'variables-types', 'operators', 'control-flow', 'loops', 'functions', 'arrays', 'strings'],
    modules: [
      {
        title: 'Chương 1 — Bắt đầu với C++',
        lessons: [
          'Giới thiệu C++ và môi trường biên dịch',
          'Chương trình C++ đầu tiên (Hello World)',
          'Câu lệnh nhập xuất cơ bản (cin, cout)',
          'Comment và quy tắc viết code',
          'Biên dịch và lỗi compile thường gặp',
        ],
      },
      {
        title: 'Chương 2 — Biến, kiểu dữ liệu và toán tử',
        lessons: [
          'Biến và kiểu dữ liệu nguyên thuỷ',
          'Kiểu số nguyên (int, long, short)',
          'Kiểu số thực (float, double)',
          'Kiểu ký tự và chuỗi (char, string)',
          'Toán tử số học và gán',
          'Toán tử so sánh và logic',
        ],
      },
      {
        title: 'Chương 3 — Điều khiển luồng',
        lessons: [
          'Câu lệnh if và if-else',
          'Câu lệnh if lồng nhau',
          'Câu lệnh switch-case',
          'Vòng lặp while và do-while',
          'Vòng lặp for',
          'Break và continue',
        ],
      },
      {
        title: 'Chương 4 — Hàm và tham số',
        lessons: [
          'Khai báo và gọi hàm',
          'Tham số và giá trị trả về',
          'Tham chiếu và pass-by-reference',
          'Hàm nạp chồng (overloading)',
          'Đệ quy căn bản',
        ],
      },
      {
        title: 'Chương 5 — Mảng và chuỗi',
        lessons: [
          'Mảng một chiều',
          'Truy cập và duyệt mảng',
          'Mảng và hàm',
          'Chuỗi ký tự (std::string)',
          'Các hàm xử lý chuỗi thường dùng',
        ],
      },
    ],
  },
  {
    slug: 'demo-cpp-advanced',
    title: 'C++ Nâng cao — OOP, Con trỏ & STL',
    description:
      'Trình độ trung cấp: con trỏ sâu, quản lý bộ nhớ, OOP đầy đủ (kế thừa, đa hình), template và STL (vector, map, algorithm). Case study: project quản lý thư viện mini.',
    locale: 'vi',
    language: 'cpp',
    pricingModel: 'paid',
    priceVnd: 299_000,
    challenge: true,
    nodes: ['pointers', 'recursion', 'oop-basics', 'oop-inheritance', 'arrays', 'strings', 'ds-stack-queue'],
    modules: [
      {
        title: 'Chương 1 — Con trỏ & bộ nhớ',
        lessons: [
          'Con trỏ là gì và tại sao cần',
          'Khai báo và sử dụng con trỏ',
          'Con trỏ và mảng',
          'Cấp phát động với new/delete',
          'Smart pointers (unique_ptr, shared_ptr)',
        ],
      },
      {
        title: 'Chương 2 — Đệ quy nâng cao',
        lessons: [
          'Tư duy đệ quy',
          'Fibonacci và memoization',
          'Quy hoạch động qua đệ quy',
          'Chia để trị (divide and conquer)',
        ],
      },
      {
        title: 'Chương 3 — Lập trình hướng đối tượng',
        lessons: [
          'Class và object',
          'Constructor và destructor',
          'Encapsulation: private/public/protected',
          'Kế thừa (inheritance)',
          'Đa hình (polymorphism)',
          'Virtual function và abstract class',
        ],
      },
      {
        title: 'Chương 4 — Template & Generic',
        lessons: [
          'Function template',
          'Class template',
          'Template specialisation',
          'Khi nào dùng template',
        ],
      },
      {
        title: 'Chương 5 — STL thực chiến',
        lessons: [
          'std::vector — cơ bản tới nâng cao',
          'std::map và std::set',
          'std::stack và std::queue',
          'Thuật toán STL: sort, find, transform',
          'Iterator: input, output, bidirectional',
        ],
      },
    ],
  },

  // ---- C language ---------------------------------------------------------
  {
    slug: 'demo-c-intro',
    title: 'Lập trình C cho người mới bắt đầu',
    description:
      'Ngôn ngữ C nền tảng của mọi ngôn ngữ hệ thống. Cú pháp, con trỏ, struct, file I/O — kiến thức cần cho kỹ sư embedded / systems.',
    locale: 'vi',
    language: 'c',
    pricingModel: 'free',
    nodes: ['io-basics', 'variables-types', 'control-flow', 'loops', 'functions', 'pointers', 'arrays'],
    modules: [
      {
        title: 'Chương 1 — C cơ bản',
        lessons: [
          'Chương trình C đầu tiên',
          'Biến và kiểu dữ liệu trong C',
          'printf và scanf',
          'Toán tử và biểu thức',
        ],
      },
      {
        title: 'Chương 2 — Luồng điều khiển',
        lessons: [
          'Câu lệnh if-else',
          'Vòng lặp for và while',
          'Hàm trong C',
          'Đệ quy cơ bản',
        ],
      },
      {
        title: 'Chương 3 — Con trỏ và mảng',
        lessons: [
          'Con trỏ trong C',
          'Mảng và con trỏ',
          'Cấp phát động với malloc/free',
          'Chuỗi ký tự trong C',
        ],
      },
      {
        title: 'Chương 4 — Struct & File I/O',
        lessons: [
          'Struct trong C',
          'Typedef và struct',
          'Đọc ghi file',
        ],
      },
    ],
  },

  // ---- Python (2 courses) -------------------------------------------------
  {
    slug: 'demo-python-fundamentals',
    title: 'Python cho người mới bắt đầu',
    description:
      'Khoá Python hoàn chỉnh từ zero. Cú pháp đơn giản, list, dictionary, hàm, OOP, xử lý file. Python là ngôn ngữ dễ học nhất và được dùng rộng rãi nhất hiện nay.',
    locale: 'vi',
    language: 'python',
    pricingModel: 'free',
    nodes: ['io-basics', 'variables-types', 'control-flow', 'loops', 'functions', 'arrays', 'strings'],
    modules: [
      {
        title: 'Chương 1 — Python cơ bản',
        lessons: [
          'Giới thiệu Python và cài đặt',
          'Chương trình Python đầu tiên',
          'Biến và kiểu dữ liệu cơ bản',
          'Nhập xuất với print và input',
          'Comment và PEP 8',
        ],
      },
      {
        title: 'Chương 2 — Điều khiển luồng',
        lessons: [
          'if-elif-else',
          'Vòng lặp for',
          'Vòng lặp while',
          'break, continue, pass',
        ],
      },
      {
        title: 'Chương 3 — Cấu trúc dữ liệu',
        lessons: [
          'List và các thao tác',
          'Tuple và khi nào dùng',
          'Dictionary — bảng băm của Python',
          'Set — tập hợp không trùng',
          'List comprehension',
        ],
      },
      {
        title: 'Chương 4 — Hàm & Module',
        lessons: [
          'Định nghĩa hàm với def',
          'Tham số default và keyword',
          '*args và **kwargs',
          'Lambda function',
          'Import và module',
        ],
      },
      {
        title: 'Chương 5 — Xử lý file & Exception',
        lessons: [
          'Đọc ghi file text',
          'Context manager với with',
          'Try-except-finally',
          'Custom exception',
        ],
      },
    ],
  },
  {
    slug: 'demo-python-data',
    title: 'Python cho phân tích dữ liệu',
    description:
      'pandas, numpy, matplotlib — toolbox chuẩn cho data analyst. Học qua 3 project thực tế: phân tích doanh số, phân tích hành vi user, visualise COVID.',
    locale: 'vi',
    language: 'python',
    pricingModel: 'paid',
    priceVnd: 349_000,
    nodes: ['arrays', 'functions', 'loops'],
    modules: [
      {
        title: 'Chương 1 — numpy',
        lessons: ['Array và dtype', 'Slicing và indexing', 'Vector hoá với numpy', 'Broadcasting'],
      },
      {
        title: 'Chương 2 — pandas',
        lessons: ['Series và DataFrame', 'Đọc CSV và Excel', 'Filter và sort', 'Group by và aggregate', 'Merge và join'],
      },
      {
        title: 'Chương 3 — Visualisation',
        lessons: ['matplotlib cơ bản', 'Biểu đồ đường và cột', 'Heatmap và scatter', 'Seaborn cho thống kê'],
      },
    ],
  },

  // ---- JavaScript ---------------------------------------------------------
  {
    slug: 'demo-js-modern',
    title: 'JavaScript hiện đại (ES6+)',
    description:
      'JS từ cú pháp ES6 đến module, async, class. Đủ nền tảng để bước vào React/Vue hay Node.js backend.',
    locale: 'vi',
    language: 'js',
    pricingModel: 'free',
    nodes: ['io-basics', 'variables-types', 'control-flow', 'loops', 'functions', 'arrays', 'strings'],
    modules: [
      {
        title: 'Chương 1 — JS cơ bản',
        lessons: [
          'var, let, const — sự khác biệt',
          'Template literal',
          'Destructuring object và array',
          'Spread và rest operator',
        ],
      },
      {
        title: 'Chương 2 — Function & Scope',
        lessons: [
          'Arrow function',
          'Closure và lexical scope',
          'Default parameter',
          'this binding',
        ],
      },
      {
        title: 'Chương 3 — Collection',
        lessons: [
          'Array methods: map, filter, reduce',
          'Object.keys / values / entries',
          'Set và Map',
          'Spread trong array và object',
        ],
      },
      {
        title: 'Chương 4 — Module & Class',
        lessons: [
          'ES6 module: import/export',
          'Class syntax',
          'Kế thừa với extends',
          'Getter và setter',
        ],
      },
    ],
  },
  {
    slug: 'demo-js-async',
    title: 'Async JavaScript & Promises',
    description:
      'Callback hell → Promise → async/await. Xử lý lỗi, Promise.all, race condition và pattern xử lý API đồng thời.',
    locale: 'vi',
    language: 'js',
    pricingModel: 'paid',
    priceVnd: 249_000,
    nodes: ['functions', 'recursion'],
    modules: [
      {
        title: 'Chương 1 — Từ Callback tới Promise',
        lessons: ['Callback và callback hell', 'Promise là gì', 'Promise chain', 'Xử lý lỗi với catch'],
      },
      {
        title: 'Chương 2 — async/await',
        lessons: ['Cú pháp async/await', 'try/catch với await', 'Promise.all và Promise.race', 'Top-level await'],
      },
    ],
  },

  // ---- HTML / CSS (markdown-only, quiz-gated) -----------------------------
  {
    slug: 'demo-html-essentials',
    title: 'HTML từ A đến Z',
    description:
      'Cấu trúc trang web, semantic tag, form, table. Không có sandbox — học qua lý thuyết + quiz AI tự sinh để kiểm tra hiểu bài.',
    locale: 'vi',
    pricingModel: 'free',
    nodes: ['io-basics'],
    modules: [
      {
        title: 'Chương 1 — HTML cơ bản',
        lessons: [
          'HTML là gì và cách trình duyệt hiển thị',
          'Cấu trúc một trang HTML',
          'Thẻ heading, paragraph, list',
          'Link và image',
        ],
      },
      {
        title: 'Chương 2 — Semantic & Form',
        lessons: [
          'Semantic tag: header, nav, section, article',
          'Thẻ form và input',
          'Validation HTML5',
          'Accessibility cơ bản',
        ],
      },
      {
        title: 'Chương 3 — Thực hành',
        lessons: [
          'Xây trang CV cá nhân',
          'Xây form đăng ký',
          'Xây landing page đơn giản',
        ],
      },
    ],
  },
  {
    slug: 'demo-css-layout',
    title: 'CSS & Layout hiện đại',
    description:
      'CSS từ selector, box model đến Flexbox, Grid và responsive. Toàn bộ lý thuyết — quiz AI xác nhận hiểu bài.',
    locale: 'vi',
    pricingModel: 'free',
    nodes: ['io-basics'],
    modules: [
      {
        title: 'Chương 1 — CSS cơ bản',
        lessons: [
          'Selector và specificity',
          'Box model',
          'Display: block, inline, inline-block',
          'Position: relative, absolute, fixed, sticky',
        ],
      },
      {
        title: 'Chương 2 — Flexbox',
        lessons: [
          'Flex container và item',
          'justify-content và align-items',
          'flex-grow, flex-shrink, flex-basis',
          'Flexbox patterns',
        ],
      },
      {
        title: 'Chương 3 — Grid',
        lessons: [
          'Grid template columns/rows',
          'Grid gap và area',
          'Auto placement',
        ],
      },
      {
        title: 'Chương 4 — Responsive',
        lessons: [
          'Mobile first',
          'Media query',
          'Đơn vị responsive: rem, em, vw, vh',
          'Container query',
        ],
      },
    ],
  },

  // ---- Theory-only (markdown + auto-gen quiz) -----------------------------
  {
    slug: 'demo-theory-software-engineering',
    title: 'Kỹ thuật phần mềm — Tổng quan',
    description:
      'Kiến thức nền tảng về vòng đời phát triển phần mềm, Agile, Scrum, testing, code review. Khoá lý thuyết, hoàn thành qua quiz AI.',
    locale: 'vi',
    pricingModel: 'free',
    nodes: ['functions', 'oop-basics'],
    modules: [
      {
        title: 'Chương 1 — Vòng đời phát triển',
        lessons: [
          'Software Development Life Cycle (SDLC)',
          'Mô hình Waterfall',
          'Mô hình Agile và Scrum',
          'DevOps và CI/CD',
        ],
      },
      {
        title: 'Chương 2 — Kỹ năng mềm kỹ sư',
        lessons: [
          'Viết user story tốt',
          'Ước lượng công việc (estimation)',
          'Code review hiệu quả',
          'Pair programming',
        ],
      },
      {
        title: 'Chương 3 — Chất lượng code',
        lessons: [
          'Unit test và integration test',
          'Test-Driven Development',
          'Refactoring căn bản',
          'SOLID principles',
        ],
      },
      {
        title: 'Chương 4 — Quản lý dự án',
        lessons: [
          'Git và branching strategy',
          'Issue tracking',
          'Documentation và README',
        ],
      },
    ],
  },
  {
    slug: 'demo-theory-networking',
    title: 'Mạng máy tính cơ bản',
    description:
      'Hiểu Internet hoạt động thế nào: TCP/IP, HTTP, DNS, SSL. Hoàn thành qua quiz — không cần sandbox.',
    locale: 'vi',
    pricingModel: 'free',
    nodes: ['io-basics'],
    modules: [
      {
        title: 'Chương 1 — Mô hình mạng',
        lessons: [
          'Mô hình OSI 7 tầng',
          'TCP/IP 4 tầng',
          'Địa chỉ IP: IPv4 và IPv6',
          'MAC address và ARP',
        ],
      },
      {
        title: 'Chương 2 — Giao thức cốt lõi',
        lessons: [
          'TCP vs UDP',
          'HTTP/HTTPS',
          'DNS — hệ thống tên miền',
          'DHCP cấp IP tự động',
        ],
      },
      {
        title: 'Chương 3 — Bảo mật mạng',
        lessons: [
          'SSL/TLS hoạt động thế nào',
          'Firewall và NAT',
          'VPN cơ bản',
          'Man-in-the-middle attack',
        ],
      },
      {
        title: 'Chương 4 — Thực tế',
        lessons: [
          'CDN và reverse proxy',
          'Load balancer',
          'WebSocket vs HTTP',
        ],
      },
    ],
  },
  {
    slug: 'demo-theory-database',
    title: 'Cơ sở dữ liệu quan hệ',
    description:
      'Mô hình quan hệ, SQL, chuẩn hoá, index và transaction. Lý thuyết có kèm ví dụ SQL — quiz AI chấm hiểu bài.',
    locale: 'vi',
    pricingModel: 'free',
    nodes: ['arrays', 'strings'],
    modules: [
      {
        title: 'Chương 1 — Mô hình quan hệ',
        lessons: [
          'Khái niệm table, row, column',
          'Khoá chính và khoá ngoại',
          'Mô hình ER (Entity-Relationship)',
        ],
      },
      {
        title: 'Chương 2 — SQL cơ bản',
        lessons: [
          'SELECT, WHERE, ORDER BY',
          'JOIN các loại',
          'GROUP BY và aggregate',
          'Subquery',
        ],
      },
      {
        title: 'Chương 3 — Chuẩn hoá',
        lessons: [
          '1NF, 2NF, 3NF',
          'Khi nào denormalize',
        ],
      },
      {
        title: 'Chương 4 — Performance',
        lessons: [
          'Index — B-tree và hash',
          'Query plan và EXPLAIN',
          'Transaction và ACID',
        ],
      },
    ],
  },
  {
    slug: 'demo-theory-oop',
    title: 'Tư duy Hướng Đối tượng',
    description:
      'OOP không phụ thuộc ngôn ngữ: encapsulation, inheritance, polymorphism, abstraction. Dùng case study để hiểu — quiz AI xác nhận.',
    locale: 'vi',
    pricingModel: 'free',
    nodes: ['oop-basics', 'oop-inheritance', 'functions'],
    modules: [
      {
        title: 'Chương 1 — 4 trụ cột',
        lessons: [
          'Encapsulation — đóng gói',
          'Inheritance — kế thừa',
          'Polymorphism — đa hình',
          'Abstraction — trừu tượng hoá',
        ],
      },
      {
        title: 'Chương 2 — Nguyên lý thiết kế',
        lessons: [
          'Single Responsibility',
          'Open/Closed',
          'Liskov Substitution',
          'Interface Segregation',
          'Dependency Inversion',
        ],
      },
      {
        title: 'Chương 3 — Pattern thường gặp',
        lessons: [
          'Singleton — khi cần, khi không',
          'Factory pattern',
          'Observer pattern',
        ],
      },
    ],
  },
  {
    slug: 'demo-theory-algorithms',
    title: 'Tư duy giải thuật',
    description:
      'Đô phức tạp thời gian/không gian, các paradigm thuật toán: greedy, DP, divide-and-conquer. Hoàn thành qua quiz.',
    locale: 'vi',
    pricingModel: 'free',
    nodes: ['algo-sorting', 'algo-searching', 'recursion', 'ds-stack-queue'],
    modules: [
      {
        title: 'Chương 1 — Độ phức tạp',
        lessons: [
          'Big-O notation',
          'So sánh O(n) vs O(n log n) vs O(n²)',
          'Space complexity',
          'Amortised analysis',
        ],
      },
      {
        title: 'Chương 2 — Paradigm',
        lessons: [
          'Brute force và khi dùng',
          'Chia để trị (divide and conquer)',
          'Greedy algorithm',
          'Dynamic programming',
        ],
      },
      {
        title: 'Chương 3 — Bài toán kinh điển',
        lessons: [
          'Sắp xếp và so sánh độ phức tạp',
          'Tìm kiếm tuyến tính vs nhị phân',
          'Bài toán balo (knapsack)',
          'Đường đi ngắn nhất',
        ],
      },
    ],
  },

  // ---- Applied / interview ------------------------------------------------
  {
    slug: 'demo-dsa-foundation',
    title: 'Cấu trúc dữ liệu & Giải thuật (Hands-on)',
    description:
      'Implement cây, stack, queue, linked list bằng C++. 25 bài code thực chiến qua sandbox.',
    locale: 'vi',
    language: 'cpp',
    pricingModel: 'paid',
    priceVnd: 299_000,
    challenge: true,
    nodes: ['ds-stack-queue', 'arrays', 'recursion', 'algo-sorting', 'algo-searching'],
    modules: [
      {
        title: 'Chương 1 — Linked List',
        lessons: ['Singly linked list', 'Doubly linked list', 'Các thao tác cơ bản', 'Reverse list', 'Detect cycle'],
      },
      {
        title: 'Chương 2 — Stack & Queue',
        lessons: ['Stack bằng mảng', 'Queue bằng mảng vòng', 'Deque', 'Balanced parentheses'],
      },
      {
        title: 'Chương 3 — Tree',
        lessons: ['Binary tree', 'Binary search tree', 'Tree traversal', 'Lowest common ancestor'],
      },
      {
        title: 'Chương 4 — Heap & Priority Queue',
        lessons: ['Heap structure', 'Heap operations', 'Heap sort', 'Top-K problem'],
      },
    ],
  },
  {
    slug: 'demo-interview-prep',
    title: 'Tuyển tập 50 bài phỏng vấn',
    description:
      'Array, string, tree, graph — mọi công ty tech đều hỏi một biến thể. Giải chi tiết + nhiều cách tiếp cận.',
    locale: 'vi',
    language: 'cpp',
    pricingModel: 'paid',
    priceVnd: 399_000,
    challenge: true,
    nodes: ['arrays', 'strings', 'algo-sorting', 'algo-searching', 'recursion', 'ds-stack-queue'],
    modules: [
      {
        title: 'Chương 1 — Array & String',
        lessons: ['Two Sum', 'Best Time to Buy Stock', 'Longest Substring Without Repeating', 'Group Anagrams'],
      },
      {
        title: 'Chương 2 — Linked List',
        lessons: ['Reverse Linked List', 'Merge Two Sorted Lists', 'Linked List Cycle'],
      },
      {
        title: 'Chương 3 — Tree',
        lessons: ['Invert Binary Tree', 'Maximum Depth', 'Binary Tree Level Order'],
      },
      {
        title: 'Chương 4 — DP',
        lessons: ['Climbing Stairs', 'House Robber', 'Coin Change'],
      },
    ],
  },
  {
    slug: 'demo-clean-code',
    title: 'Clean Code thực hành',
    description:
      'Refactor codebase rối → clean qua 10 code smell hay gặp. Áp dụng SOLID vào ví dụ C++.',
    locale: 'vi',
    language: 'cpp',
    pricingModel: 'paid',
    priceVnd: 249_000,
    nodes: ['functions', 'oop-basics'],
    modules: [
      {
        title: 'Chương 1 — Code smell',
        lessons: ['Long method', 'Large class', 'Duplicated code', 'Feature envy'],
      },
      {
        title: 'Chương 2 — Refactoring',
        lessons: ['Extract method', 'Extract class', 'Rename variable', 'Replace magic number'],
      },
      {
        title: 'Chương 3 — Apply SOLID',
        lessons: ['SRP qua ví dụ', 'OCP qua ví dụ', 'Dependency Injection'],
      },
    ],
  },
  {
    slug: 'demo-python-web',
    title: 'Flask & REST API',
    description:
      'Xây REST API đầu tiên với Flask + SQLite. Authentication, CRUD, testing.',
    locale: 'vi',
    language: 'python',
    pricingModel: 'paid',
    priceVnd: 299_000,
    nodes: ['functions', 'strings'],
    modules: [
      {
        title: 'Chương 1 — Flask cơ bản',
        lessons: ['Hello Flask', 'Route và HTTP methods', 'Request và Response', 'JSON API'],
      },
      {
        title: 'Chương 2 — Database',
        lessons: ['SQLite với SQLAlchemy', 'Model và migration', 'CRUD endpoint'],
      },
      {
        title: 'Chương 3 — Auth & Deploy',
        lessons: ['JWT authentication', 'Rate limiting', 'Deploy lên Heroku / Render'],
      },
    ],
  },
  {
    slug: 'demo-english-cpp',
    title: 'Intro to Programming in C++',
    description:
      'English-taught entry course — variables, control flow, functions, arrays. Perfect for international students.',
    locale: 'en',
    language: 'cpp',
    pricingModel: 'free',
    nodes: ['io-basics', 'variables-types', 'control-flow', 'loops', 'functions'],
    modules: [
      {
        title: 'Chapter 1 — Getting Started',
        lessons: ['What is C++?', 'Your First Program', 'Variables and Types', 'Basic I/O'],
      },
      {
        title: 'Chapter 2 — Control Flow',
        lessons: ['If and Else', 'Loops', 'Switch Statement'],
      },
      {
        title: 'Chapter 3 — Functions',
        lessons: ['Declaring Functions', 'Parameters and Return Values', 'Function Overloading'],
      },
      {
        title: 'Chapter 4 — Arrays',
        lessons: ['One-Dimensional Arrays', 'Arrays and Loops', 'String Basics'],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Content generation — produce ~500 char Vietnamese markdown per lesson. We
// pattern-match keywords in the topic to emit realistic prose plus 1 small
// code block when the course has an executable language. The output is
// deliberately short enough that DeepSeek's quiz generator stays under its
// 6KB cap, and long enough (≥ 80 chars, per the api-core guard) to pass.
// ---------------------------------------------------------------------------

function codeSampleFor(language: CodeLanguage | undefined, topic: string): string | null {
  if (!language) return null;
  const t = topic.toLowerCase();
  if (language === 'cpp' || language === 'c') {
    if (t.includes('hello') || t.includes('first') || t.includes('đầu tiên')) {
      return language === 'cpp'
        ? `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello World!";\n    return 0;\n}`
        : `#include <stdio.h>\n\nint main() {\n    printf("Hello World!\\n");\n    return 0;\n}`;
    }
    if (t.includes('biến') || t.includes('variable') || t.includes('kiểu')) {
      return `int age = 22;\ndouble gpa = 3.5;\nchar grade = 'A';\nstring name = "An";`;
    }
    if (t.includes('if') || t.includes('điều kiện')) {
      return `int n = 7;\nif (n % 2 == 0) {\n    cout << n << " is even";\n} else {\n    cout << n << " is odd";\n}`;
    }
    if (t.includes('vòng lặp') || t.includes('loop') || t.includes('for')) {
      return `for (int i = 1; i <= 5; i++) {\n    cout << i << " ";\n}\n// output: 1 2 3 4 5`;
    }
    if (t.includes('hàm') || t.includes('function')) {
      return `int add(int a, int b) {\n    return a + b;\n}\n\nint main() {\n    cout << add(3, 4);\n    return 0;\n}`;
    }
    if (t.includes('mảng') || t.includes('array')) {
      return `int arr[5] = {1, 2, 3, 4, 5};\nfor (int i = 0; i < 5; i++) {\n    cout << arr[i] << " ";\n}`;
    }
    if (t.includes('con trỏ') || t.includes('pointer')) {
      return `int x = 10;\nint* p = &x;\ncout << *p << endl;  // 10\n*p = 20;\ncout << x << endl;   // 20`;
    }
    if (t.includes('class') || t.includes('lớp') || t.includes('object')) {
      return `class Point {\npublic:\n    int x, y;\n    Point(int x, int y) : x(x), y(y) {}\n};`;
    }
    if (t.includes('kế thừa') || t.includes('inheritance')) {
      return `class Animal {\npublic:\n    void eat() { cout << "eating"; }\n};\n\nclass Dog : public Animal {\npublic:\n    void bark() { cout << "woof"; }\n};`;
    }
    return null;
  }
  if (language === 'python') {
    if (t.includes('hello') || t.includes('đầu tiên') || t.includes('first')) {
      return `print("Hello World!")`;
    }
    if (t.includes('biến') || t.includes('kiểu')) {
      return `age = 22          # int\ngpa = 3.5         # float\nname = "An"       # str\nis_student = True # bool`;
    }
    if (t.includes('if') || t.includes('điều kiện')) {
      return `n = 7\nif n % 2 == 0:\n    print(f"{n} is even")\nelse:\n    print(f"{n} is odd")`;
    }
    if (t.includes('for') || t.includes('while') || t.includes('vòng lặp')) {
      return `for i in range(1, 6):\n    print(i, end=" ")\n# output: 1 2 3 4 5`;
    }
    if (t.includes('list')) {
      return `nums = [1, 2, 3, 4, 5]\nsquared = [x * x for x in nums]\nprint(squared)  # [1, 4, 9, 16, 25]`;
    }
    if (t.includes('dictionary')) {
      return `student = {"name": "An", "age": 22, "gpa": 3.5}\nprint(student["name"])\nstudent["email"] = "an@example.com"`;
    }
    if (t.includes('hàm') || t.includes('function') || t.includes('def')) {
      return `def add(a, b):\n    return a + b\n\nprint(add(3, 4))  # 7`;
    }
    if (t.includes('pandas')) {
      return `import pandas as pd\n\ndf = pd.read_csv("sales.csv")\nprint(df.head())\nprint(df.describe())`;
    }
    if (t.includes('flask')) {
      return `from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef hello():\n    return {"msg": "hello"}`;
    }
    return null;
  }
  if (language === 'js') {
    if (t.includes('hello') || t.includes('đầu tiên')) return `console.log("Hello World!");`;
    if (t.includes('const') || t.includes('let')) {
      return `const PI = 3.14;       // immutable\nlet count = 0;         // reassignable\ncount++;\n// var is legacy — avoid`;
    }
    if (t.includes('arrow')) {
      return `const add = (a, b) => a + b;\nconst double = x => x * 2;\nconsole.log(add(3, 4));`;
    }
    if (t.includes('map') || t.includes('filter') || t.includes('reduce')) {
      return `const nums = [1, 2, 3, 4, 5];\nconst doubled = nums.map(x => x * 2);\nconst sum = nums.reduce((a, b) => a + b, 0);`;
    }
    if (t.includes('async') || t.includes('await') || t.includes('promise')) {
      return `async function fetchUser(id) {\n  const res = await fetch(\`/users/\${id}\`);\n  return res.json();\n}`;
    }
    if (t.includes('class')) {
      return `class Point {\n  constructor(x, y) {\n    this.x = x;\n    this.y = y;\n  }\n}`;
    }
    return null;
  }
  return null;
}

function lessonContent(topic: string, language: CodeLanguage | undefined): string {
  const sample = codeSampleFor(language, topic);
  const codeLang = language === 'cpp' ? 'cpp' : language === 'c' ? 'c' : language === 'python' ? 'python' : language === 'js' ? 'javascript' : '';
  const codeBlock = sample ? `\n\n\`\`\`${codeLang}\n${sample}\n\`\`\`\n` : '';

  // Short, topic-flavoured intro + 2–3 bullet points + optional code + closing
  // remark. Deliberately not too specific — this is demo seed content, the
  // real pedagogical value is in the teacher's edits. We just need enough
  // text for quiz generation and heatmap signal.
  const bullets = [
    `Khái niệm trọng tâm của bài "${topic}" — hiểu được nguyên lý giúp bạn áp dụng vào bài tập phía sau.`,
    `Điểm thường nhầm lẫn: đọc kỹ ví dụ minh hoạ và so sánh với cách bạn từng viết.`,
    `Khi nào dùng: liệt kê ít nhất 2 tình huống thực tế bạn có thể áp dụng ngay.`,
  ];

  const intro = `## ${topic}\n\nBài học này tập trung vào **${topic.toLowerCase()}** — một khái niệm nền tảng bạn sẽ gặp lại ở mọi bài kế tiếp. Hãy đọc chậm, quan sát ví dụ và ghi chú câu hỏi để hỏi AI Tutor nếu còn vướng.`;

  const points = `\n\n**Ba ý chính:**\n- ${bullets[0]}\n- ${bullets[1]}\n- ${bullets[2]}`;

  const closing = `\n\n> Tip: sau khi đọc xong, dùng nút **"Giải thích"** trên block code để AI Tutor giải nghĩa từng dòng — đặc biệt hữu ích khi bạn tự học.`;

  return intro + points + codeBlock + closing;
}

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------

interface Archetype {
  name: string;
  weight: number;
  acRate: number;
  activityMultiplier: number;
  preferDomain?: CodeLanguage;
}

const ARCHETYPES: Archetype[] = [
  { name: 'absolute-beginner', weight: 0.22, acRate: 0.28, activityMultiplier: 0.7 },
  { name: 'steady-learner',    weight: 0.32, acRate: 0.58, activityMultiplier: 1.0 },
  { name: 'strong-performer',  weight: 0.15, acRate: 0.85, activityMultiplier: 1.3 },
  { name: 'cpp-focused',       weight: 0.10, acRate: 0.70, activityMultiplier: 1.1, preferDomain: 'cpp' },
  { name: 'python-focused',    weight: 0.08, acRate: 0.68, activityMultiplier: 1.1, preferDomain: 'python' },
  { name: 'js-focused',        weight: 0.07, acRate: 0.66, activityMultiplier: 1.05, preferDomain: 'js' },
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

function placeholderSource(language: CodeLanguage, seq: number): string {
  switch (language) {
    case 'cpp':
      return `// seed-massive submission #${seq}\n#include <iostream>\nint main() { std::cout << "demo"; return 0; }\n`;
    case 'c':
      return `/* seed-massive submission #${seq} */\n#include <stdio.h>\nint main() { printf("demo"); return 0; }\n`;
    case 'python':
      return `# seed-massive submission #${seq}\nprint("demo")\n`;
    case 'js':
      return `// seed-massive submission #${seq}\nconsole.log("demo");\n`;
  }
}

// ---------------------------------------------------------------------------
// Seeding pipeline
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
      update: {
        title: spec.title,
        description: spec.description,
        status: 'published',
        pricingModel: spec.pricingModel,
        priceCents: spec.pricingModel === 'paid' ? (spec.priceVnd ?? 199_000) * 100 : null,
        currency: spec.pricingModel === 'paid' ? 'VND' : null,
      },
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

    // Wipe any stale modules so re-seed produces clean state.
    await prisma.module.deleteMany({ where: { courseId: course.id } });

    // How many lessons of this course should be code exercises? Theory-only
    // courses → 0%. Hands-on courses with a declared language → 60–70%.
    const theoryOnly = !spec.language;

    for (let mi = 0; mi < spec.modules.length; mi++) {
      const modSpec = spec.modules[mi]!;
      const mod = await prisma.module.create({
        data: {
          courseId: course.id,
          title: modSpec.title,
          sortOrder: mi,
        },
      });

      for (let li = 0; li < modSpec.lessons.length; li++) {
        const topic = modSpec.lessons[li]!;
        const isExercise = !theoryOnly && rand() < 0.65;
        const type: LessonType = isExercise ? 'exercise' : 'markdown';

        const lesson = await prisma.lesson.create({
          data: {
            moduleId: mod.id,
            title: topic,
            sortOrder: li,
            type,
            contentMarkdown: lessonContent(topic, spec.language),
            estMinutes: 8 + Math.floor(rand() * 10),
          },
        });

        // Tag lesson with 1–2 relevant knowledge nodes from the course slate.
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

        if (isExercise && spec.language) {
          const ex = await prisma.exercise.create({
            data: {
              lessonId: lesson.id,
              language: spec.language,
              starterCode: placeholderSource(spec.language, 0),
              solutionCode: placeholderSource(spec.language, 0),
              isChallenge: spec.challenge ?? false,
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
    const created = await Promise.all(batch.map((data) => prisma.user.create({ data })));
    for (let i = 0; i < created.length; i++) {
      rows.push({
        id: created[i]!.id,
        email: created[i]!.email,
        archetypeIdx: archetypeIndices[i]!,
      });
    }
  }

  await prisma.userRole.createMany({
    data: rows.map((r) => ({ userId: r.id, roleId: role.id })),
    skipDuplicates: true,
  });

  return rows;
}

async function seedEnrolments(
  students: StudentRow[],
  allCourseIds: string[],
): Promise<Map<string, string[]>> {
  const studentToCourses = new Map<string, string[]>();
  const data: Array<{ userId: string; courseId: string; enrolledAt: Date }> = [];
  for (const s of students) {
    const n = randInt(ENROLMENTS_PER_STUDENT_MIN, ENROLMENTS_PER_STUDENT_MAX);
    const shuffled = [...allCourseIds].sort(() => rand() - 0.5).slice(0, n);
    studentToCourses.set(s.id, shuffled);
    const enrolledAt = new Date(Date.now() - randInt(10, 60) * 24 * 60 * 60 * 1000);
    for (const courseId of shuffled) data.push({ userId: s.id, courseId, enrolledAt });
  }
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
    // Only courses that have exercises produce submissions — theory-only
    // courses contribute through quiz_attempts (not modelled in this seed;
    // a second pass can call the /quiz/attempts endpoint if we want BKT
    // signal from quizzes too).
    const candidateExercises = enrolledCourseIds.flatMap((cid) => exercisesByCourse.get(cid) ?? []);
    if (candidateExercises.length === 0) continue;

    const n = perStudent[si]!;
    for (let k = 0; k < n; k++) {
      let ex = pick(candidateExercises);
      if (archetype.preferDomain) {
        const matching = candidateExercises.filter((e) => e.language === archetype.preferDomain);
        if (matching.length > 0 && rand() < 0.65) ex = pick(matching);
      }
      const verdict = pickVerdict(archetype.acRate);
      const createdAt = new Date(now - Math.floor(rand() * windowMs));
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

// ---------------------------------------------------------------------------
// AI-chat seeding for P9.1 Teacher Insight demo — the heatmap works off
// Postgres mastery but the "AI Tutor Insights" panel reads ai_chats from
// Mongo. We insert a few dozen realistic Vietnamese questions tied to
// random demo students + demo lessons so the panel has actual signal at
// demo time. Skipped silently when MONGO_URL is empty (dev-only box).
// ---------------------------------------------------------------------------

const DEMO_CHAT_TEMPLATES: Array<{ q: string; a: string }> = [
  { q: 'cout là gì và dùng như thế nào?', a: '`cout` là luồng xuất chuẩn trong C++, dùng để in dữ liệu ra màn hình. Ví dụ: `cout << "Hello";`' },
  { q: 'Sự khác nhau giữa == và = là gì?', a: '`=` là toán tử gán (đặt giá trị). `==` là toán tử so sánh bằng (trả về true/false).' },
  { q: 'Vòng lặp for và while khác nhau chỗ nào?', a: '`for` phù hợp khi biết trước số lần lặp. `while` phù hợp khi điều kiện phức tạp / chưa biết số lần.' },
  { q: 'Con trỏ là gì? Tôi vẫn chưa hiểu.', a: 'Con trỏ là biến lưu địa chỉ của một biến khác. Khi dereference (`*p`) bạn lấy được giá trị tại địa chỉ đó.' },
  { q: 'Tại sao code của tôi báo segmentation fault?', a: 'Thường là do truy cập con trỏ null hoặc tràn mảng. Hãy kiểm tra mọi con trỏ trước khi dereference.' },
  { q: 'Khi nào nên dùng recursion thay vì loop?', a: 'Dùng đệ quy khi bài toán có cấu trúc cây / chia-để-trị tự nhiên. Dùng loop khi chỉ duyệt tuần tự.' },
  { q: 'Hàm khác phương thức (method) chỗ nào?', a: 'Phương thức là hàm gắn với một class / object. Hàm tự do không thuộc class nào.' },
  { q: 'std::vector nhanh hơn mảng C không?', a: 'Về truy cập thì tương đương (O(1)). `vector` chậm hơn một chút khi cấp phát động nhưng an toàn hơn rất nhiều.' },
  { q: 'Tại sao phải dùng const?', a: '`const` giúp compiler bắt lỗi ngay khi bạn vô tình ghi đè biến không nên thay đổi. Code dễ review hơn.' },
  { q: 'Hàm inline có thực sự nhanh hơn không?', a: 'Không luôn. Compiler hiện đại tự inline các hàm nhỏ. `inline` chủ yếu giúp tránh lỗi "multiple definition" trong header.' },
  { q: 'Làm sao debug lỗi WA trong bài tập?', a: 'In ra giá trị biến tại từng bước, so sánh với output mong đợi. Đặc biệt chú ý edge case: input rỗng, số âm, N=0.' },
  { q: 'Độ phức tạp O(n log n) nghĩa là gì?', a: 'Thời gian chạy tăng theo n nhân log(n). Nhanh hơn O(n²), chậm hơn O(n). Điển hình: merge sort, quick sort.' },
  { q: 'Binary search hoạt động ra sao?', a: 'Chia đôi mảng đã sắp xếp, so sánh với giữa, chọn nửa phù hợp, lặp lại. O(log n).' },
  { q: 'Stack và Queue khác nhau chỗ nào?', a: 'Stack = LIFO (vào sau ra trước). Queue = FIFO (vào trước ra trước). Dùng cho các bài toán khác hẳn nhau.' },
  { q: 'Tại sao không nên dùng using namespace std;?', a: 'Trong code lớn hoặc header file, nó gây đụng tên. Ở code bài tập nhỏ thì chấp nhận được.' },
];

async function seedDemoAiChats(
  students: StudentRow[],
  exercises: SeededExercise[],
): Promise<void> {
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.warn('[massive] MONGO_URL not set — skipping ai_chats seed');
    return;
  }
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 3_000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGO_DB ?? 'lms_telemetry');
    const col = db.collection('ai_chats');
    // Clear any stale demo chats first — keyed by userIds we're about to
    // create chats for.
    await col.deleteMany({ userId: { $in: students.map((s) => s.id) } });

    // All candidate lessons (any type) belonging to demo courses.
    const lessons = await prisma.lesson.findMany({
      where: { module: { course: { slug: { startsWith: 'demo-' } } } },
      select: { id: true },
    });
    if (lessons.length === 0) return;

    const now = Date.now();
    const WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // last 14 days
    const TARGET_CHATS = 80;

    const docs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < TARGET_CHATS; i++) {
      const student = pick(students);
      const lesson = pick(lessons);
      const template = pick(DEMO_CHAT_TEMPLATES);
      const at = new Date(now - Math.floor(rand() * WINDOW_MS));
      docs.push({
        schemaVersion: 1,
        userId: student.id,
        lessonId: lesson.id,
        provider: rand() < 0.3 ? 'deepseek' : 'llama',
        locale: 'vi',
        startedAt: at,
        lastActivityAt: at,
        messages: [
          { role: 'user', content: template.q, at },
          { role: 'assistant', content: template.a, at: new Date(at.getTime() + 2_000) },
        ],
      });
    }
    await col.insertMany(docs);
    console.warn(`[massive] wrote ${docs.length} ai_chats docs to Mongo`);

    // Also wipe + reseed learning_events for a minimal activity-log feel.
    const events = db.collection('learning_events');
    await events.deleteMany({ userId: { $in: students.map((s) => s.id) } });
    const eventNames = ['lesson_open', 'tab_focus', 'tab_blur', 'submit_click'];
    const evDocs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 200; i++) {
      const student = pick(students);
      const lesson = pick(lessons);
      const at = new Date(now - Math.floor(rand() * WINDOW_MS));
      evDocs.push({
        schemaVersion: 1,
        userId: student.id,
        lessonId: lesson.id,
        event: pick(eventNames),
        metadata: {},
        at,
      });
    }
    await events.insertMany(evDocs);
    console.warn(`[massive] wrote ${evDocs.length} learning_events docs to Mongo`);
  } finally {
    await client.close();
  }
}

async function seedMastery(students: StudentRow[]): Promise<void> {
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
  const bucket = new Map<string, Bucket>();
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
    const raw = attempts > 0 ? b.pass / attempts : 0.1;
    const jitter = (rand() - 0.5) * 0.08;
    const score = Math.max(0.05, Math.min(0.95, raw + jitter));
    const confidence = attempts / (attempts + 5);
    masteryRows.push({ userId, nodeId, score, confidence, attempts });
  }

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
  // Order matters — two FK gotchas to navigate:
  //   1. courses own exercises which own test_cases; test_cases have
  //      submission_test_results referencing them with RESTRICT (no
  //      cascade). So we first delete any submissions against demo
  //      exercises, which cascades submission_test_results away, clearing
  //      the path for the course-level cascade delete.
  //   2. courses reference the demo teacher via teacher_id — wipe
  //      courses before users, else the teacher delete would fail FK.
  const { count: submissionCount } = await prisma.submission.deleteMany({
    where: {
      exercise: {
        lesson: { module: { course: { slug: { startsWith: 'demo-' } } } },
      },
    },
  });
  const { count: courseCount } = await prisma.course.deleteMany({
    where: { slug: { startsWith: 'demo-' } },
  });
  const { count: userCount } = await prisma.user.deleteMany({
    where: { email: { endsWith: '@demo.khohoc.online' } },
  });
  console.warn(
    `[massive] wiped ${submissionCount} submissions + ${courseCount} courses + ${userCount} users`,
  );
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
  const totalLessons = COURSES.reduce(
    (sum, c) => sum + c.modules.reduce((s, m) => s + m.lessons.length, 0),
    0,
  );
  console.warn(
    `[massive] → ${exercises.length} exercises across ${COURSES.length} courses (${totalLessons} lessons total)`,
  );

  console.warn(`[massive] seeding ${NUM_STUDENTS} virtual students`);
  const students = await seedStudents();
  console.warn(`[massive] → ${students.length} students`);

  const allCourses = await prisma.course.findMany({ where: { slug: { startsWith: 'demo-' } } });
  console.warn('[massive] enrolling students in 3–6 courses each');
  const studentToCourses = await seedEnrolments(
    students,
    allCourses.map((c) => c.id),
  );

  console.warn(`[massive] generating ~${TARGET_SUBMISSIONS} submissions (45-day window)`);
  await seedSubmissions(students, exercises, studentToCourses);

  await seedMastery(students);

  console.warn('[massive] seeding demo AI chats + events into Mongo (for P9.1 Teacher Insight)');
  await seedDemoAiChats(students, exercises);

  const elapsed = ((Date.now() - started) / 1_000).toFixed(1);
  console.warn(`[massive] done in ${elapsed}s`);

  const [uCount, sCount, mCount, theoryCount] = await Promise.all([
    prisma.user.count({ where: { email: { endsWith: '@demo.khohoc.online' } } }),
    prisma.submission.count(),
    prisma.userMastery.count(),
    prisma.course.count({
      where: { slug: { startsWith: 'demo-' }, modules: { none: { lessons: { some: { type: 'exercise' } } } } },
    }),
  ]);
  console.warn(
    `[massive] db totals: demo_users=${uCount} submissions=${sCount} mastery_rows=${mCount} theory_only_courses=${theoryCount}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
