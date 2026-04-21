import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MasteryTrigger } from '../../knowledge/mastery-trigger.service';
import type { AuthenticatedUser } from '../../iam/auth/auth.types';
import { QuizAiClient } from './quiz-ai.client';
import type { QuizAttemptDto } from './dto/attempt.dto';

// Threshold for a quiz attempt to count as a *mastery signal* for the BKT
// engine. This is NOT a gate any more — completion is granted on every
// attempt (and on the plain "Đánh dấu hoàn thành" button). The threshold
// is purely a signal-quality filter: if the student got less than half
// right we don't want that noise feeding the knowledge graph.
const PASS_THRESHOLD = 50;

// Default question count for the micro-check. Product decision (2026-04-21):
// theory lessons should feel like a relaxed "quick check", not a test.
// Two MCQs is enough to verify the student read the page.
const DEFAULT_NUM_QUESTIONS = 2;

// Questions are stored as a JSON column. This is the shape we *write* —
// everything the runtime needs, including the answer key and explanation.
// The public GET response strips the answer fields; the POST-attempt
// response adds them back per question so the student sees the solution.
interface StoredQuestion {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface PublicQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface AttemptSummary {
  id: string;
  score: number;
  passed: boolean;
  attempted_at: string;
}

export interface QuizPayload {
  lesson_id: string;
  generated_at: string;
  model: string;
  pass_threshold: number;
  questions: PublicQuestion[];
  attempts: AttemptSummary[];
  best_score: number | null;
  // True once the student has either marked the lesson complete OR taken
  // the quiz at least once. UI checkmarks/CTA swaps key off this.
  completed: boolean;
}

export interface AttemptResult {
  attempt_id: string;
  score: number;
  passed: boolean;
  pass_threshold: number;
  details: Array<{
    question_id: string;
    selected_index: number;
    correct_index: number;
    correct: boolean;
    explanation: string;
  }>;
  fired_mastery_rebuild: boolean;
  completed: boolean;
}

export interface MarkCompleteResult {
  completed: boolean;
  method: 'mark' | 'quiz';
  completed_at: string;
}

@Injectable()
export class QuizService {
  private readonly log = new Logger(QuizService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: QuizAiClient,
    private readonly mastery: MasteryTrigger,
  ) {}

  /**
   * Fetch (or generate-and-cache) the quiz for a lesson. Returns the
   * student-safe shape: options are included, the correct index is not.
   */
  async getOrGenerate(user: AuthenticatedUser, lessonId: string): Promise<QuizPayload> {
    const lesson = await this.loadLessonOrThrow(lessonId, user);

    // Fast path — cache hit.
    let quiz = await this.prisma.lessonQuiz.findUnique({ where: { lessonId } });

    if (!quiz) {
      // Cold path — ask ai-gateway to generate, cache the result.
      if (!lesson.contentMarkdown || lesson.contentMarkdown.trim().length < 80) {
        throw new BadRequestException({
          code: 'lesson_content_too_short',
          message: 'Lesson content is too short to generate a quiz',
        });
      }
      const locale: 'vi' | 'en' = user.locale === 'en' ? 'en' : 'vi';
      const result = await this.ai.generate({
        lessonTitle: lesson.title,
        lessonContent: lesson.contentMarkdown,
        locale,
        numQuestions: DEFAULT_NUM_QUESTIONS,
      });
      const stored: StoredQuestion[] = result.questions.map((q, i) => ({
        id: q.id || `q${i + 1}`,
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        explanation: q.explanation,
      }));
      quiz = await this.prisma.lessonQuiz.upsert({
        where: { lessonId },
        create: { lessonId, questions: stored as unknown as object[], model: result.model },
        update: { questions: stored as unknown as object[], model: result.model },
      });
      this.log.log(`quiz generated lesson=${lessonId} model=${result.model}`);
    }

    const questions = (quiz.questions as unknown as StoredQuestion[]) ?? [];

    const [attemptRows, completion] = await Promise.all([
      this.prisma.quizAttempt.findMany({
        where: { userId: user.id, lessonId },
        orderBy: { attemptedAt: 'desc' },
        take: 10,
      }),
      this.prisma.lessonCompletion.findUnique({
        where: { userId_lessonId: { userId: user.id, lessonId } },
      }),
    ]);
    const bestScore = attemptRows.length ? Math.max(...attemptRows.map((a) => a.score)) : null;

    return {
      lesson_id: lessonId,
      generated_at: quiz.generatedAt.toISOString(),
      model: quiz.model,
      pass_threshold: PASS_THRESHOLD,
      questions: questions.map((q) => ({ id: q.id, question: q.question, options: q.options })),
      attempts: attemptRows.map((a) => ({
        id: a.id,
        score: a.score,
        passed: a.passed,
        attempted_at: a.attemptedAt.toISOString(),
      })),
      best_score: bestScore,
      completed: completion != null,
    };
  }

  /**
   * Mark a lesson complete without taking the quiz. Idempotent — re-clicks
   * keep the original completedAt and method. Doesn't fire BKT (reading
   * alone isn't a mastery signal).
   */
  async markComplete(user: AuthenticatedUser, lessonId: string): Promise<MarkCompleteResult> {
    await this.loadLessonOrThrow(lessonId, user);
    const existing = await this.prisma.lessonCompletion.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId } },
    });
    if (existing) {
      return {
        completed: true,
        method: existing.method as 'mark' | 'quiz',
        completed_at: existing.completedAt.toISOString(),
      };
    }
    const row = await this.prisma.lessonCompletion.create({
      data: { userId: user.id, lessonId, method: 'mark' },
    });
    this.log.log(`lesson completion user=${user.id} lesson=${lessonId} method=mark`);
    return {
      completed: true,
      method: 'mark',
      completed_at: row.completedAt.toISOString(),
    };
  }

  async attempt(
    user: AuthenticatedUser,
    lessonId: string,
    dto: QuizAttemptDto,
  ): Promise<AttemptResult> {
    await this.loadLessonOrThrow(lessonId, user);

    const quiz = await this.prisma.lessonQuiz.findUnique({ where: { lessonId } });
    if (!quiz) {
      throw new NotFoundException({
        code: 'quiz_not_generated',
        message: 'Quiz has not been generated yet — open it first to generate',
      });
    }
    const stored = (quiz.questions as unknown as StoredQuestion[]) ?? [];

    // Grade: one point per correct answer, rounded percentage.
    const details: AttemptResult['details'] = [];
    let correctCount = 0;
    for (const q of stored) {
      const given = dto.answers.find((a) => a.question_id === q.id);
      const selected = given?.selected_index ?? -1;
      const isCorrect = selected === q.correct_index;
      if (isCorrect) correctCount += 1;
      details.push({
        question_id: q.id,
        selected_index: selected,
        correct_index: q.correct_index,
        correct: isCorrect,
        explanation: q.explanation,
      });
    }
    const score = stored.length === 0 ? 0 : Math.round((correctCount / stored.length) * 100);
    const passed = score >= PASS_THRESHOLD;

    const row = await this.prisma.quizAttempt.create({
      data: {
        userId: user.id,
        lessonId,
        answers: dto.answers as unknown as object[],
        score,
        passed,
      },
    });

    // EVERY attempt marks the lesson complete — a student who tried is
    // engaged, regardless of score. Product decision 2026-04-21: don't
    // gate completion on a quiz score (bounce rate is worse than noise).
    await this.prisma.lessonCompletion.upsert({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      create: { userId: user.id, lessonId, method: 'quiz' },
      update: {}, // keep the original completedAt + method on retries
    });

    // Only a "passing" attempt (≥ PASS_THRESHOLD) updates BKT — low-score
    // attempts are noisy signal we don't want feeding the knowledge graph.
    // Fire-and-forget so a slow data-science service never delays the
    // user's result screen.
    let firedMastery = false;
    if (passed) {
      this.mastery.rebuildForUser(user.id);
      firedMastery = true;
    }

    this.log.log(
      `quiz attempt user=${user.id} lesson=${lessonId} score=${score} passed=${passed}`,
    );

    return {
      attempt_id: row.id,
      score,
      passed,
      pass_threshold: PASS_THRESHOLD,
      details,
      fired_mastery_rebuild: firedMastery,
      completed: true,
    };
  }

  private async loadLessonOrThrow(lessonId: string, user: AuthenticatedUser) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: { include: { course: { select: { id: true, status: true, teacherId: true } } } },
      },
    });
    if (!lesson) {
      throw new NotFoundException({ code: 'lesson_not_found', message: 'Lesson not found' });
    }
    const courseStatus = lesson.module.course.status;
    const isAdminOrTeacher =
      user.roles.includes('admin') || user.id === lesson.module.course.teacherId;
    if (courseStatus !== 'published' && !isAdminOrTeacher) {
      throw new ForbiddenException({
        code: 'forbidden_by_policy',
        message: 'Course is not available',
      });
    }
    return lesson;
  }
}
