'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';

// Formative quiz panel (P9.0). Rendered on non-code lessons in place of the
// Monaco editor. The quiz is DeepSeek-generated on first open, cached per
// lesson, and a passing attempt (≥70%) fires a BKT mastery rebuild — same
// signal the code-submission path uses. Failed attempts don't count against
// the student; they can retake until they pass.

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
}

export function LessonQuizPanel({ lessonId }: { lessonId: string }) {
  const t = useTranslations('lesson.quiz');

  const [quiz, setQuiz] = useState<QuizPayload | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);

  // Load cached quiz (if any) on mount — does NOT trigger generation.
  useEffect(() => {
    // We don't want to force-generate on mount (that costs a DeepSeek call
    // for every lesson view). Instead we peek: if the quiz already exists
    // in cache, show "Retry" state with attempt history; otherwise leave
    // the "Start quiz" button as entry point. The GET endpoint does both
    // generate and fetch, so we treat the *first* click as the generator.
  }, [lessonId]);

  const onStart = async () => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setGenerating(true);
    setError(null);
    try {
      const data = await api.quiz.get(token, lessonId);
      setQuiz(data);
      // Preselect the most-recent pass's answers? We don't store them on
      // the client, and showing a "fresh quiz" each retake is less
      // confusing than half-filled UI. Leave selections blank.
      setSelected({});
      setResult(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'lesson_content_too_short') {
        setError(t('content_too_short'));
      } else {
        setError(err instanceof ApiError ? err.message : t('generate_failed'));
      }
    } finally {
      setGenerating(false);
    }
  };

  const onSubmit = async () => {
    if (!quiz) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    // Require every question answered before allowing submit.
    const answers = quiz.questions.map((q) => ({
      question_id: q.id,
      selected_index: selected[q.id] ?? -1,
    }));
    if (answers.some((a) => a.selected_index < 0)) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.quiz.attempt(token, lessonId, answers);
      setResult(res);
      // Re-pull the summary so attempts + best_score reflect this attempt
      // without another round-trip just for stats.
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
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('generate_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const onRetry = () => {
    setResult(null);
    setSelected({});
  };

  // Entry — no quiz loaded yet.
  if (!quiz) {
    return (
      <section className="card">
        <h2 className="text-xl font-semibold text-text">{t('title')}</h2>
        <p className="mt-2 text-sm text-text-muted">
          {t('subtitle', { threshold: 70 })}
        </p>
        {error ? <p className="mt-3 text-sm" style={{ color: '#ff6b6b' }}>{error}</p> : null}
        <button
          type="button"
          onClick={onStart}
          disabled={generating}
          className="btn mt-4"
        >
          {generating ? t('generating') : t('start_cta')}
        </button>
      </section>
    );
  }

  const allAnswered = quiz.questions.every((q) => selected[q.id] != null);

  return (
    <section className="card">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-text">{t('title')}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {t('need_score', { threshold: quiz.pass_threshold })}
          </p>
          {quiz.best_score != null ? (
            <p className="mt-1 text-xs text-text-muted">
              {t('best_score', { score: quiz.best_score })}
            </p>
          ) : null}
        </div>
        {result ? (
          <div
            className="rounded-pill px-3 py-1 text-xs font-semibold"
            style={{
              background: result.passed ? 'rgba(40, 167, 69, 0.15)' : 'rgba(220, 53, 69, 0.15)',
              color: result.passed ? '#28a745' : '#dc3545',
            }}
          >
            {t('score', { score: result.score })} · {result.passed ? t('passed') : t('failed')}
          </div>
        ) : null}
      </header>

      <ol className="flex flex-col gap-5">
        {quiz.questions.map((q, idx) => {
          const detail = result?.details.find((d) => d.question_id === q.id);
          return (
            <li key={q.id} className="rounded-box border border-border bg-panel p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {t('question_n', { n: idx + 1 })}
              </p>
              <p className="mb-3 text-sm font-medium text-text">{q.question}</p>
              <div className="flex flex-col gap-2">
                {q.options.map((opt, optIdx) => {
                  const isSelected = selected[q.id] === optIdx;
                  let bg = 'var(--bg-panel)';
                  let bd = 'var(--border-color)';
                  let color = 'var(--text-main)';
                  if (detail) {
                    // Post-submit styling: highlight correct green, chosen-wrong red.
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
                      style={{ background: bg, border: `1px solid ${bd}`, color }}
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
                  <span className="font-semibold text-text">{t('explanation')}: </span>
                  {detail.explanation}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {error ? <p className="mt-3 text-sm" style={{ color: '#ff6b6b' }}>{error}</p> : null}

      {!result ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!allAnswered || submitting}
          className="btn mt-5"
        >
          {submitting ? t('submitting') : t('submit')}
        </button>
      ) : result.passed ? (
        <div
          className="mt-5 rounded-box p-4 text-sm"
          style={{ background: 'rgba(40, 167, 69, 0.08)', color: '#28a745' }}
        >
          {t('pass_message')}
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-3">
          <p className="text-sm text-text-muted">{t('try_again')}</p>
          <button type="button" onClick={onRetry} className="btn btn-secondary">
            {t('retry')}
          </button>
        </div>
      )}
    </section>
  );
}
