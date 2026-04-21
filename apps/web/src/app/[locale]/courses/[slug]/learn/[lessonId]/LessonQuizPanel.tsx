'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';

// Lesson-completion panel for non-code lessons (P9.0, refined 2026-04-21).
//
// Product decision: theory lessons should feel like a relaxed read, not a
// test. "Đánh dấu hoàn thành" is the primary CTA. Below it, a collapsed
// optional micro-check — 1–2 AI-generated MCQs with NO pass gate, NO
// score penalty, unlimited retries — so curious students can self-check
// without friction, and the rest can skip.
//
// Anything in this panel that feeds BKT mastery:
//   · Quiz attempt with score ≥ 50% → yes (strong signal)
//   · Quiz attempt with score < 50%   → no (noise)
//   · Mark complete button            → no (reading ≠ mastery)

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
}

interface QuizAttemptSummary {
  id: string;
  score: number;
  passed: boolean;
  attempted_at: string;
}

interface QuizPayload {
  lesson_id: string;
  generated_at: string;
  model: string;
  pass_threshold: number;
  questions: QuizQuestion[];
  attempts: QuizAttemptSummary[];
  best_score: number | null;
  completed: boolean;
}

interface AttemptResult {
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

export function LessonQuizPanel({ lessonId }: { lessonId: string }) {
  const tQ = useTranslations('lesson.quiz');
  const tC = useTranslations('lesson.complete');

  const [completed, setCompleted] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  const [quizExpanded, setQuizExpanded] = useState(false);
  const [quiz, setQuiz] = useState<QuizPayload | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);

  // The quiz is generation-heavy (one DeepSeek call), so we never eagerly
  // load it on render. Clicking "Đánh dấu hoàn thành" or expanding the
  // optional quiz panel is what kicks off backend work.

  const onMarkComplete = async () => {
    if (completed || marking) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setMarking(true);
    setMarkError(null);
    try {
      await api.quiz.markComplete(token, lessonId);
      setCompleted(true);
    } catch (err) {
      setMarkError(err instanceof ApiError ? err.message : tC('failed'));
    } finally {
      setMarking(false);
    }
  };

  const loadQuiz = async () => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setQuizLoading(true);
    setQuizError(null);
    try {
      const data = await api.quiz.get(token, lessonId);
      setQuiz(data);
      setCompleted(data.completed);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'lesson_content_too_short') {
        setQuizError(tQ('content_too_short'));
      } else {
        setQuizError(err instanceof ApiError ? err.message : tQ('generate_failed'));
      }
    } finally {
      setQuizLoading(false);
    }
  };

  const onToggleQuiz = async () => {
    const next = !quizExpanded;
    setQuizExpanded(next);
    if (next && !quiz) await loadQuiz();
  };

  const onSubmitQuiz = async () => {
    if (!quiz) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    const answers = quiz.questions.map((q) => ({
      question_id: q.id,
      selected_index: selected[q.id] ?? -1,
    }));
    if (answers.some((a) => a.selected_index < 0)) return;
    setSubmitting(true);
    setQuizError(null);
    try {
      const res = await api.quiz.attempt(token, lessonId, answers);
      setResult(res);
      setCompleted(true);
      setQuiz({
        ...quiz,
        attempts: [
          {
            id: res.attempt_id,
            score: res.score,
            passed: res.passed,
            attempted_at: new Date().toISOString(),
          },
          ...quiz.attempts,
        ].slice(0, 10),
        best_score: Math.max(res.score, quiz.best_score ?? 0),
        completed: true,
      });
    } catch (err) {
      setQuizError(err instanceof ApiError ? err.message : tQ('generate_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const onRetry = () => {
    setResult(null);
    setSelected({});
  };

  const allAnswered = quiz ? quiz.questions.every((q) => selected[q.id] != null) : false;

  return (
    <section className="flex flex-col gap-4">
      {/* Primary: mark-complete card */}
      <div
        className="card flex flex-col gap-3"
        style={{
          borderColor: completed ? 'rgba(40, 167, 69, 0.4)' : undefined,
          background: completed ? 'rgba(40, 167, 69, 0.06)' : undefined,
        }}
      >
        {completed ? (
          <>
            <h2 className="text-xl font-semibold" style={{ color: '#28a745' }}>
              {tC('done')}
            </h2>
            <p className="text-sm text-text-muted">{tC('done_subtitle')}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted">{tC('helper')}</p>
            <button
              type="button"
              onClick={onMarkComplete}
              disabled={marking}
              className="btn self-start"
            >
              {marking ? tC('marking') : tC('cta')}
            </button>
            {markError ? (
              <p className="text-xs" style={{ color: '#ff6b6b' }}>
                {markError}
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Secondary: collapsed optional quiz */}
      <div className="card">
        <button
          type="button"
          onClick={onToggleQuiz}
          className="flex w-full items-start justify-between gap-4 text-left"
        >
          <div>
            <h3 className="text-base font-semibold text-text">{tQ('title')}</h3>
            <p className="mt-1 text-xs text-text-muted">{tQ('subtitle')}</p>
            {quiz?.best_score != null ? (
              <p className="mt-1 text-xs text-text-muted">
                {tQ('best_score', { score: quiz.best_score })}
              </p>
            ) : null}
          </div>
          <span className="text-text-muted">{quizExpanded ? '▾' : '▸'}</span>
        </button>

        {quizExpanded ? (
          <div className="mt-4">
            {quizLoading ? (
              <p className="text-sm text-text-muted">{tQ('generating')}</p>
            ) : quizError ? (
              <p className="text-sm" style={{ color: '#ff6b6b' }}>
                {quizError}
              </p>
            ) : quiz ? (
              <>
                <ol className="flex flex-col gap-4">
                  {quiz.questions.map((q, idx) => {
                    const detail = result?.details.find((d) => d.question_id === q.id);
                    return (
                      <li key={q.id} className="rounded-box border border-border bg-panel p-4">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                          {tQ('question_n', { n: idx + 1 })}
                        </p>
                        <p className="mb-3 text-sm font-medium text-text">{q.question}</p>
                        <div className="flex flex-col gap-2">
                          {q.options.map((opt, optIdx) => {
                            const isSelected = selected[q.id] === optIdx;
                            let bg = 'var(--bg-panel)';
                            let bd = 'var(--border-color)';
                            let color = 'var(--text-main)';
                            if (detail) {
                              if (optIdx === detail.correct_index) {
                                bg = 'rgba(40, 167, 69, 0.12)';
                                bd = '#28a745';
                                color = '#28a745';
                              } else if (optIdx === detail.selected_index) {
                                bg = 'rgba(220, 53, 69, 0.12)';
                                bd = '#dc3545';
                                color = '#dc3545';
                              }
                            } else if (isSelected) {
                              bg = 'rgba(247, 189, 77, 0.1)';
                              bd = 'var(--accent)';
                            }
                            return (
                              <label
                                key={optIdx}
                                className="flex cursor-pointer items-start gap-3 rounded-box px-3 py-2 transition-colors"
                                style={{
                                  background: bg,
                                  border: `1px solid ${bd}`,
                                  color,
                                }}
                              >
                                <input
                                  type="radio"
                                  name={q.id}
                                  disabled={Boolean(detail) || submitting}
                                  checked={isSelected}
                                  onChange={() => setSelected({ ...selected, [q.id]: optIdx })}
                                  className="mt-0.5"
                                />
                                <span className="text-sm">{opt}</span>
                              </label>
                            );
                          })}
                        </div>
                        {detail ? (
                          <p className="mt-3 text-xs text-text-muted">
                            <span className="font-semibold text-text">
                              {tQ('explanation')}:{' '}
                            </span>
                            {detail.explanation}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>

                {!result ? (
                  <button
                    type="button"
                    onClick={onSubmitQuiz}
                    disabled={!allAnswered || submitting}
                    className="btn mt-4"
                  >
                    {submitting ? tQ('submitting') : tQ('submit')}
                  </button>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    <div
                      className="rounded-box p-3 text-sm"
                      style={{
                        background:
                          result.score >= quiz.pass_threshold
                            ? 'rgba(40, 167, 69, 0.08)'
                            : 'rgba(247, 189, 77, 0.08)',
                        color: result.score >= quiz.pass_threshold ? '#28a745' : 'var(--accent)',
                      }}
                    >
                      <div className="font-semibold">{tQ('score', { score: result.score })}</div>
                      <div className="mt-1">
                        {result.score >= quiz.pass_threshold
                          ? tQ('pass_message')
                          : tQ('low_score_message')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onRetry}
                      className="btn btn-secondary self-start"
                    >
                      {tQ('retry')}
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
