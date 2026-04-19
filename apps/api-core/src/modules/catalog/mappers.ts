import type {
  CourseDetail,
  CourseSummary,
  LessonType,
  ModuleWithLessons,
  PricingModel,
  CourseStatus,
} from '@lms/shared-types';

// Prisma returns rich objects with its own casing; the shared DTOs use
// snake_case per the api-design-principles. Keep the translation in one place
// so every endpoint stays consistent.

type PrismaTeacher = { id: string; displayName: string };

interface PrismaCourseBase {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: CourseStatus;
  pricingModel: PricingModel;
  priceCents: number | null;
  currency: string | null;
  coverUrl: string | null;
  locale: string;
  publishedAt: Date | null;
  teacher: PrismaTeacher;
}

interface PrismaLesson {
  id: string;
  title: string;
  sortOrder: number;
  type: LessonType;
  estMinutes: number | null;
}

interface PrismaModule {
  id: string;
  title: string;
  sortOrder: number;
  lessons?: PrismaLesson[];
}

export function courseSummaryFromPrisma(
  c: PrismaCourseBase,
  lessonCount: number,
): CourseSummary {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    teacher: { id: c.teacher.id, display_name: c.teacher.displayName },
    status: c.status,
    pricing_model: c.pricingModel,
    price_cents: c.priceCents,
    currency: c.currency,
    cover_url: c.coverUrl,
    locale: c.locale,
    published_at: c.publishedAt ? c.publishedAt.toISOString() : null,
    lesson_count: lessonCount,
  };
}

export function courseDetailFromPrisma(
  c: PrismaCourseBase & { modules: PrismaModule[] },
  lessonCount: number,
  isEnrolled: boolean,
): CourseDetail {
  const modules: ModuleWithLessons[] = c.modules.map((m) => ({
    id: m.id,
    title: m.title,
    sort_order: m.sortOrder,
    lessons: (m.lessons ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      sort_order: l.sortOrder,
      type: l.type,
      est_minutes: l.estMinutes,
    })),
  }));
  return {
    ...courseSummaryFromPrisma(c, lessonCount),
    modules,
    is_enrolled: isEnrolled,
  };
}
