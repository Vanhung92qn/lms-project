// Fixed vocabulary for the onboarding questionnaire.
//
// Each goal maps to a ranked list of course slugs — the first slug is the
// "headline" recommendation for that goal, the rest are filler. The matcher
// flattens all of the student's picked goals, dedups while preserving
// ranking, and feeds that list into the recommendations endpoint. Slugs
// that don't exist in the DB (e.g. a course was unpublished) are skipped
// silently.

export const GOAL_SLUGS = [
  'cpp-foundation',
  'python-basics',
  'web-dev',
  'data-analysis',
  'algorithms',
  'theory-foundation',
] as const;

export type GoalSlug = (typeof GOAL_SLUGS)[number];

export const LEVELS = ['novice', 'learning-basics', 'intermediate'] as const;
export type Level = (typeof LEVELS)[number];

export const WEEKLY_HOURS = ['<2', '2-5', '5-10', '10+'] as const;
export type WeeklyHours = (typeof WEEKLY_HOURS)[number];

// Course-slug catalog per goal. Kept in TypeScript (not a DB join table)
// because the mapping is a product decision, not user data. If we later
// want teachers to tag their own courses against goals, we add a
// `goal_tags` table — but for the demo, this explicit table wins on
// clarity and reviewability.
const GOAL_TO_COURSES: Record<GoalSlug, string[]> = {
  'cpp-foundation': ['demo-cpp-fundamentals', 'demo-c-intro', 'demo-english-cpp', 'demo-cpp-advanced'],
  'python-basics': ['demo-python-fundamentals', 'demo-python-data', 'demo-python-web'],
  'web-dev': ['demo-html-essentials', 'demo-css-layout', 'demo-js-modern', 'demo-js-async'],
  'data-analysis': ['demo-python-data', 'demo-theory-database', 'demo-python-fundamentals'],
  'algorithms': [
    'demo-dsa-foundation',
    'demo-theory-algorithms',
    'demo-interview-prep',
    'demo-cpp-advanced',
  ],
  'theory-foundation': [
    'demo-theory-software-engineering',
    'demo-theory-networking',
    'demo-theory-database',
    'demo-theory-oop',
    'demo-theory-algorithms',
  ],
};

// Level gate — an "intermediate" student skips the most basic courses,
// while a "novice" gets funneled straight into fundamentals. Returns a
// de-duplicated, ranked list of course slugs to match.
export function coursesForProfile(goals: GoalSlug[], level: Level): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  // Beginners get the fundamentals-heavy slugs at the top; intermediates
  // get them pushed down by applying a light re-rank.
  for (const goal of goals) {
    for (const slug of GOAL_TO_COURSES[goal] ?? []) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      ordered.push(slug);
    }
  }
  if (level === 'intermediate') {
    // Demote courses whose slug contains "fundamentals" / "basics" / "intro"
    // so advanced tracks surface first for someone who says they're
    // intermediate.
    ordered.sort((a, b) => {
      const aBasic = /fundamentals|basics|intro|essentials/.test(a) ? 1 : 0;
      const bBasic = /fundamentals|basics|intro|essentials/.test(b) ? 1 : 0;
      return aBasic - bBasic;
    });
  }
  return ordered;
}
