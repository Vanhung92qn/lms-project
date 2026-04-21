'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/lib/i18n/routing';
import { useSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';
import type { LessonDetail, Submission, Verdict } from '@lms/shared-types';
import { AITutorPanel } from './AITutorPanel';
import { LessonQuizPanel } from './LessonQuizPanel';
import { CodeBlock } from '@/components/lesson/CodeBlock';

// Monaco is a heavy (~2 MB) bundle that imports self-mutating browser
// globals. Loading it through next/dynamic with ssr:false keeps it out
// of the server bundle and avoids React 18 hydration churn.
const MonacoEditor = dynamic(
  () => import('@/components/editor/MonacoEditor').then((m) => m.MonacoEditor),
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-text-muted">…</div> },
);

export function WorkspacePlayer({ slug, lessonId }: { slug: string; lessonId: string }) {
  const t = useTranslations('lesson');
  const router = useRouter();
  const { user, isLoading } = useSession();

  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [source, setSource] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const STORAGE_KEY = `lms-code:${lessonId}`;

  // -- auth gate + load --------------------------------------------------------
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    (async () => {
      try {
        const data = await api.getLesson(lessonId, token);
        setLesson(data);
        // Prefill source: stored draft > starter code > empty.
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored != null) {
          setSource(stored);
        } else if (data.exercise?.starter_code) {
          setSource(data.exercise.starter_code);
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'not_enrolled') {
          // Bounce them to the course page so they can enrol.
          router.replace(`/courses/${slug}` as never);
          return;
        }
        setLoadError(err instanceof ApiError ? err.message : t('load_failed'));
      }
    })();
  }, [isLoading, user, lessonId, router, slug, t, STORAGE_KEY]);

  // Persist draft on every keystroke (throttling isn't needed — sessionStorage
  // writes are under 1 ms for payloads we care about).
  useEffect(() => {
    if (!lesson) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, source);
    } catch {
      /* quota / private browsing — ignore */
    }
  }, [source, lesson, STORAGE_KEY]);

  const onSubmit = async () => {
    if (!lesson?.exercise || submitting) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.submit(token, {
        exercise_id: lesson.exercise.id,
        source_code: source,
      });
      setSubmission(res);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : t('submit_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const resetToStarter = () => {
    if (lesson?.exercise?.starter_code != null) {
      setSource(lesson.exercise.starter_code);
    }
  };

  // -- render ------------------------------------------------------------------
  // NOTE: the parent `/courses/layout.tsx` already wraps every child in
  // <ClientLayout> (which renders <TopHeader />). Rendering it again here
  // stacked two identical bars in the viewport — see screenshot from
  // p3b.1. The fix is simply not to render it here.
  if (isLoading || (!lesson && !loadError)) {
    return <main className="grid min-h-[50vh] place-items-center text-text-muted">…</main>;
  }
  if (loadError) {
    return (
      <main className="mx-auto max-w-[800px] px-6 py-10">
        <div className="card text-center">
          <p style={{ color: '#ff6b6b' }}>{loadError}</p>
        </div>
      </main>
    );
  }
  if (!lesson) return null;

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-4">
        {/* Breadcrumb + nav */}
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-2 text-xs text-text-muted">
            <Link href={`/courses/${lesson.course.slug}` as never} className="hover:text-text">
              {lesson.course.title}
            </Link>
            <span>›</span>
            <span>{lesson.module.title}</span>
            <span>›</span>
            <span className="font-semibold text-text">{lesson.title}</span>
          </nav>
          <div className="flex items-center gap-2">
            {lesson.prev_lesson ? (
              <Link
                href={`/courses/${lesson.course.slug}/learn/${lesson.prev_lesson.id}` as never}
                className="btn btn-secondary small"
              >
                ← {t('prev')}
              </Link>
            ) : null}
            {lesson.next_lesson ? (
              <Link
                href={`/courses/${lesson.course.slug}/learn/${lesson.next_lesson.id}` as never}
                className="btn btn-secondary small"
              >
                {t('next')} →
              </Link>
            ) : null}
          </div>
        </header>

        {lesson.exercise ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:h-[calc(100vh-8rem)]">
            {/* Left: theory */}
            <section className="card overflow-y-auto">
              <h1 className="mb-4 text-2xl font-bold tracking-tight text-text">{lesson.title}</h1>
              <MarkdownBody
                markdown={lesson.content_markdown}
                lessonId={lessonId}
                lessonTitle={lesson.title}
              />
              {lesson.exercise.sample_test_cases.length > 0 ? (
                <SampleTestCases cases={lesson.exercise.sample_test_cases} />
              ) : null}
            </section>

            {/* Right: editor + terminal */}
            <section className="grid grid-rows-[1fr_320px] gap-4 min-h-[60vh]">
              <div className="card flex flex-col overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-border bg-code px-4 py-2">
                  <span className="font-mono text-xs text-text-muted">
                    main.{langExt(lesson.exercise.language)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={resetToStarter}
                      className="rounded-pill border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:text-text"
                    >
                      {t('reset')}
                    </button>
                    <button
                      type="button"
                      onClick={onSubmit}
                      disabled={submitting || !source.trim()}
                      className="rounded-pill bg-accent px-4 py-1.5 text-xs font-semibold text-panel transition-all hover:bg-accent-hover disabled:opacity-50"
                    >
                      {submitting ? '…' : `${t('submit')} ⌘↵`}
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <MonacoEditor
                    value={source}
                    onChange={setSource}
                    language={lesson.exercise.language}
                    onSubmit={onSubmit}
                  />
                </div>
              </div>
              <BottomPanel
                submission={submission}
                error={submitError}
                loading={submitting}
                sampleCases={lesson.exercise.sample_test_cases}
                lessonTitle={lesson.title}
                lessonId={lessonId}
                source={source}
              />
            </section>
          </div>
        ) : (
          /* Non-code (markdown-only) lesson — theory on top, AI-generated
             formative quiz below serves as the completion gate. */
          <div className="mx-auto flex max-w-[900px] flex-col gap-4">
            <section className="card">
              <h1 className="mb-4 text-2xl font-bold tracking-tight text-text">{lesson.title}</h1>
              <MarkdownBody
                markdown={lesson.content_markdown}
                lessonId={lessonId}
                lessonTitle={lesson.title}
              />
            </section>
            <LessonQuizPanel lessonId={lessonId} />
          </div>
        )}
      </main>
  );
}

// ---------- Markdown renderer ----------

function MarkdownBody({
  markdown,
  lessonId,
  lessonTitle,
}: {
  markdown: string;
  lessonId?: string;
  lessonTitle?: string;
}) {
  return (
    <div className="prose prose-sm max-w-none text-text">
      <style>{`
        .prose h1 { font-size: 1.5rem; font-weight: 700; margin: 0.6rem 0 0.4rem; }
        .prose h2 { font-size: 1.25rem; font-weight: 600; margin: 0.8rem 0 0.4rem; }
        .prose h3 { font-size: 1.05rem; font-weight: 600; margin: 0.6rem 0 0.3rem; }
        .prose p { margin: 0.6rem 0; line-height: 1.65; color: var(--text-muted); }
        .prose a { color: var(--accent); }
        .prose ul, .prose ol { margin: 0.6rem 0 0.6rem 1.2rem; color: var(--text-muted); }
        .prose li { margin: 0.2rem 0; }
        .prose strong { color: var(--text-main); font-weight: 600; }
        .prose :not(pre) > code { font-family: 'Fira Code', monospace; font-size: 0.85em;
          background: var(--bg-code); border: 1px solid var(--border-color);
          padding: 1px 6px; border-radius: 6px; color: var(--text-main); }
        .prose blockquote { border-left: 3px solid var(--accent); padding-left: 12px; color: var(--text-muted); margin: 0.6rem 0; }
      `}</style>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Fenced code blocks (``` with or without a language) get intercepted
          // and rendered through <CodeBlock>, which brings its own <pre>
          // wrapper + Copy / Giải thích buttons. Inline `code` stays plain.
          code({ className, children, ...rest }) {
            const match = /language-([\w-]+)/.exec(className ?? '');
            if (match) {
              const raw = String(children).replace(/\n$/, '');
              return (
                <CodeBlock
                  code={raw}
                  language={match[1] ?? ''}
                  lessonId={lessonId}
                  lessonTitle={lessonTitle}
                />
              );
            }
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
          // Suppress the default <pre> wrapper for fenced blocks — CodeBlock
          // produces its own. Everything else passes through untouched.
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

// ---------- Sample test cases ----------

function SampleTestCases({
  cases,
}: {
  cases: Array<{ id: string; input: string; expected_output: string }>;
}) {
  const t = useTranslations('lesson');
  return (
    <section className="mt-6 border-t border-border pt-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
        {t('samples')}
      </h2>
      <div className="flex flex-col gap-3">
        {cases.map((tc, idx) => (
          <div key={tc.id} className="rounded-box bg-code p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              {t('sample_n', { n: idx + 1 })}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] uppercase text-text-muted">{t('input')}</p>
                <pre className="overflow-x-auto rounded-box bg-panel p-2 font-mono text-xs text-text">
                  {tc.input || <span className="text-text-muted">(empty)</span>}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase text-text-muted">{t('expected')}</p>
                <pre className="overflow-x-auto rounded-box bg-panel p-2 font-mono text-xs text-text">
                  {tc.expected_output || <span className="text-text-muted">(empty)</span>}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Terminal / verdict panel ----------

// Tabbed bottom panel: Terminal (verdict table) ↔ AI Tutor chat. Lives in
// the grid row that used to hold the solitary terminal — no layout change.
function BottomPanel({
  submission,
  error,
  loading,
  sampleCases,
  lessonTitle,
  lessonId,
  source,
}: {
  submission: Submission | null;
  error: string | null;
  loading: boolean;
  sampleCases: Array<{ id: string; input: string; expected_output: string }>;
  lessonTitle: string;
  lessonId: string;
  source: string;
}) {
  const tTutor = useTranslations('tutor');
  const [tab, setTab] = useState<'terminal' | 'tutor'>('terminal');

  // Nudge the student toward the AI Tutor whenever a verdict is non-AC.
  // A subtle dot on the Tutor tab is enough; we don't auto-switch so
  // they keep seeing the terminal output they just asked for.
  const shouldHintTutor =
    submission != null && submission.verdict !== 'ac' && submission.verdict !== 'pending';

  return (
    <div className="card flex flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border bg-code px-1 py-1">
        <div role="tablist" className="flex items-center gap-1">
          <TabButton
            active={tab === 'terminal'}
            onClick={() => setTab('terminal')}
            label={tTutor('tab_terminal')}
          />
          <TabButton
            active={tab === 'tutor'}
            onClick={() => setTab('tutor')}
            label={tTutor('tab_tutor')}
            badge={shouldHintTutor && tab !== 'tutor'}
          />
        </div>
      </div>
      {/*
        Both panels stay mounted so the tutor's chat history (and any
        in-flight stream) survives a tab flip. We toggle with `hidden`
        instead of conditional rendering — cheap in CSS, preserves
        component state across the round trip.
      */}
      <div className="relative min-h-0 flex-1">
        <div className={`absolute inset-0 ${tab === 'terminal' ? '' : 'hidden'}`}>
          <TerminalPanel
            submission={submission}
            error={error}
            loading={loading}
            sampleCases={sampleCases}
            lessonId={lessonId}
          />
        </div>
        <div className={`absolute inset-0 ${tab === 'tutor' ? '' : 'hidden'}`}>
          <AITutorPanel
            lessonId={lessonId}
            lessonTitle={lessonTitle}
            source={source}
            lastVerdict={submission?.verdict ?? null}
            lastStderr={submission?.stderr ?? null}
          />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${
        active ? 'bg-panel text-text shadow-soft' : 'text-text-muted hover:text-text'
      }`}
    >
      {label}
      {badge ? (
        <span
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
          style={{ background: '#ef4444' }}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

function TerminalPanel({
  submission,
  error,
  loading,
  sampleCases,
  lessonId,
}: {
  submission: Submission | null;
  error: string | null;
  loading: boolean;
  sampleCases: Array<{ id: string; input: string; expected_output: string }>;
  lessonId: string;
}) {
  const t = useTranslations('lesson');

  // Map sample id → expected output so test rows can show the expected
  // output beside the student's actual. Hidden (non-sample) test cases
  // won't be in this map — the UI shows "—" for their expected column,
  // preserving the "hidden" contract for graded judges.
  const sampleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const tc of sampleCases) m.set(tc.id, tc.expected_output);
    return m;
  }, [sampleCases]);

  return (
    <div className="flex h-full flex-col">
      {submission ? (
        <div className="flex items-center justify-between border-b border-border bg-code px-4 py-2">
          <span className="font-mono text-xs text-text-muted">
            {t('last_verdict')}
          </span>
          <VerdictBadge verdict={submission.verdict} runtime={submission.runtime_ms} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs">
        {loading ? (
          <p className="text-text-muted">{t('grading')}…</p>
        ) : error ? (
          <pre className="whitespace-pre-wrap" style={{ color: '#ff6b6b' }}>
            {error}
          </pre>
        ) : !submission ? (
          <p className="text-text-muted">{t('hint_submit')}</p>
        ) : submission.verdict === 'ce' ? (
          <div>
            <p className="mb-2 font-semibold" style={{ color: '#ff6b6b' }}>
              {t('verdict.ce')}
            </p>
            <pre className="whitespace-pre-wrap text-text-muted">{submission.stderr ?? ''}</pre>
          </div>
        ) : (
          <>
            {submission.verdict === 'ac' ? (
              <CompletionBanner lessonId={lessonId} />
            ) : null}
            <TestResultsTable submission={submission} sampleById={sampleById} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Shown above the verdict table when the submission is AC. Fetches the
 * next-lesson suggestion from the Knowledge Graph (prereq-gated by
 * mastery) and renders it as a CTA. Suppresses itself when the student
 * is already at the last lesson of the course.
 */
function CompletionBanner({ lessonId }: { lessonId: string }) {
  const t = useTranslations('lesson.completion');
  const [suggestion, setSuggestion] = useState<
    | { lessonId: string; title: string; courseSlug: string; gatedByPrereq: boolean }
    | null
    | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    const token = (() => {
      try {
        return sessionStorage.getItem('lms-access');
      } catch {
        return null;
      }
    })();
    if (!token) return;
    (async () => {
      try {
        const data = await api.knowledge.nextSuggestion(token, lessonId);
        if (!cancelled) setSuggestion(data);
      } catch {
        if (!cancelled) setSuggestion(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  return (
    <div
      className="mb-3 flex flex-col gap-2 rounded-box border px-3 py-3"
      style={{ borderColor: 'rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)' }}
    >
      <p className="font-sans text-sm font-semibold" style={{ color: '#22c55e' }}>
        ✓ {t('great_job')}
      </p>
      {suggestion === undefined ? (
        <p className="font-sans text-xs text-text-muted">{t('loading')}</p>
      ) : suggestion === null ? (
        <p className="font-sans text-xs text-text-muted">{t('course_end')}</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-sans text-xs text-text-muted">{t('next_up')}</p>
            <p className="truncate font-sans text-sm text-text">{suggestion.title}</p>
            {suggestion.gatedByPrereq ? (
              <p className="mt-1 font-sans text-[11px]" style={{ color: '#f59e0b' }}>
                ⚠ {t('prereq_warning')}
              </p>
            ) : null}
          </div>
          <Link
            href={
              `/courses/${suggestion.courseSlug}/learn/${suggestion.lessonId}` as never
            }
            className="rounded-pill bg-accent px-4 py-1.5 font-sans text-xs font-semibold text-panel transition-colors hover:bg-accent-hover"
          >
            {t('continue_cta')} →
          </Link>
        </div>
      )}
    </div>
  );
}

function TestResultsTable({
  submission,
  sampleById,
}: {
  submission: Submission;
  sampleById: Map<string, string>;
}) {
  const t = useTranslations('lesson');
  const passed = submission.test_results.filter((r) => r.passed).length;
  const total = submission.test_results.length;
  const totalRuntime = submission.test_results.reduce((n, r) => n + (r.runtime_ms ?? 0), 0);
  const allPassed = passed === total && total > 0;

  return (
    <div>
      {/* Summary strip */}
      <div
        className="mb-3 flex flex-wrap items-center gap-3 rounded-box border px-3 py-2 text-[11px]"
        style={{
          borderColor: allPassed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
          background: allPassed ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)',
        }}
      >
        <span className="font-semibold" style={{ color: allPassed ? '#22c55e' : '#ef4444' }}>
          {passed}/{total} {t('passed')}
        </span>
        <span className="text-text-muted">·</span>
        <span className="text-text-muted">{totalRuntime} ms {t('total_runtime')}</span>
        <span className="text-text-muted">·</span>
        <VerdictBadge verdict={submission.verdict} />
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left uppercase tracking-wider text-text-muted">
            <th className="w-10 py-1">#</th>
            <th className="py-1">{t('result')}</th>
            <th className="py-1">{t('runtime')}</th>
            <th className="py-1">{t('output_head')}</th>
            <th className="py-1">{t('expected')}</th>
          </tr>
        </thead>
        <tbody>
          {submission.test_results.map((r, i) => {
            const expected = sampleById.get(r.test_case_id);
            const isHidden = expected === undefined;
            return (
              <tr
                key={r.test_case_id}
                className="border-t border-border align-top"
                style={{
                  background: r.passed ? 'transparent' : 'rgba(239,68,68,0.04)',
                }}
              >
                <td className="py-1.5 text-text-muted">{i + 1}</td>
                <td className="py-1.5">
                  <VerdictBadge verdict={r.verdict} />
                </td>
                <td className="py-1.5 text-text-muted">
                  {r.runtime_ms != null ? `${r.runtime_ms} ms` : '—'}
                </td>
                <td className="max-w-[240px] py-1.5 text-text-muted">
                  <code className="block whitespace-pre-wrap break-all">
                    {(r.actual_output ?? '').slice(0, 160) || <em className="text-text-muted/70">(empty)</em>}
                  </code>
                </td>
                <td className="max-w-[240px] py-1.5 text-text-muted">
                  {isHidden ? (
                    <span className="rounded-pill bg-code px-2 py-0.5 text-[10px] uppercase tracking-wider">
                      {t('hidden_case')}
                    </span>
                  ) : (
                    <code className="block whitespace-pre-wrap break-all">
                      {expected.slice(0, 160) || <em className="text-text-muted/70">(empty)</em>}
                    </code>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {submission.stderr ? (
        <pre className="mt-3 whitespace-pre-wrap rounded-box bg-code p-2 text-[11px] text-text-muted">
          {submission.stderr.slice(0, 600)}
        </pre>
      ) : null}
    </div>
  );
}

// ---------- Verdict badge ----------

function VerdictBadge({
  verdict,
  runtime,
}: {
  verdict: Verdict;
  runtime?: number | null;
}) {
  const colour = useMemo(() => verdictColour(verdict), [verdict]);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: colour.bg, color: colour.fg }}
    >
      {verdict}
      {runtime != null ? <span className="opacity-70">· {runtime}ms</span> : null}
    </span>
  );
}

function verdictColour(v: Verdict): { bg: string; fg: string } {
  switch (v) {
    case 'ac':
      return { bg: 'rgba(34,197,94,0.18)', fg: '#22c55e' };
    case 'wa':
      return { bg: 'rgba(245,158,11,0.18)', fg: '#f59e0b' };
    case 'tle':
    case 'mle':
      return { bg: 'rgba(249,115,22,0.18)', fg: '#f97316' };
    case 'ce':
    case 're':
    case 'ie':
      return { bg: 'rgba(239,68,68,0.18)', fg: '#ef4444' };
    default:
      return { bg: 'rgba(100,116,139,0.18)', fg: '#64748b' };
  }
}

function langExt(l: 'c' | 'cpp' | 'js' | 'python'): string {
  return l === 'cpp' ? 'cpp' : l === 'js' ? 'js' : l === 'python' ? 'py' : 'c';
}
