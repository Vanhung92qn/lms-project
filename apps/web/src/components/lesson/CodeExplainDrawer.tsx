'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

// Right-side drawer that streams an AI explanation of a code snippet. Shares
// the same backend SSE endpoint the AITutorPanel uses (`/ai/tutor/ask` with
// `intent=concept-explain`), but is a one-shot widget — no multi-turn chat,
// no history, just "here's the code, here's what it does" for every code
// block in a lesson. Closes on Escape or backdrop click.

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/$/,
  '',
);

interface Props {
  open: boolean;
  onClose: () => void;
  code: string;
  language: string; // display label — 'cpp', 'python', 'plaintext', etc.
  lessonId?: string;
  lessonTitle?: string;
}

export function CodeExplainDrawer({ open, onClose, code, language, lessonId, lessonTitle }: Props) {
  const t = useTranslations('lesson.code_block');
  const [explanation, setExplanation] = useState<string>('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<string>('');
  const flushScheduledRef = useRef<boolean>(false);

  // Token coalescing mirrors AITutorPanel — batch setStates to one per frame
  // so a fast DeepSeek stream doesn't jank on CPU-bound clients.
  const flushPending = () => {
    const chunk = pendingRef.current;
    pendingRef.current = '';
    flushScheduledRef.current = false;
    if (!chunk) return;
    setExplanation((prev) => prev + chunk);
  };
  const scheduleFlush = () => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    requestAnimationFrame(flushPending);
  };

  // Kick off the stream whenever the drawer transitions from closed → open.
  // processEvent is intentionally defined inline so the effect's dep list
  // doesn't drag in an unstable reference the linter would flag.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setExplanation('');
    setError(null);
    setStreaming(true);

    const processEvent = (raw: string) => {
      const lines = raw.split('\n');
      let event = 'message';
      let data = '';
      for (const ln of lines) {
        if (ln.startsWith('event:')) event = ln.slice(6).trim();
        else if (ln.startsWith('data:')) data += ln.slice(5).trim();
      }
      if (event === 'token' && data) {
        try {
          const { delta } = JSON.parse(data) as { delta: string };
          pendingRef.current += delta;
          scheduleFlush();
        } catch {
          /* ignore */
        }
      } else if (event === 'error') {
        flushPending();
        try {
          const parsed = JSON.parse(data) as { message?: string };
          setError(parsed.message ?? t('failed'));
        } catch {
          setError(t('failed'));
        }
      }
    };

    void (async () => {
      let token: string | null = null;
      try {
        token = sessionStorage.getItem('lms-access');
      } catch {
        token = null;
      }
      if (!token) {
        setError(t('sign_in_required'));
        setStreaming(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/ai/tutor/ask`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            intent: 'concept-explain',
            locale: 'vi',
            lesson_id: lessonId,
            lesson_title: lessonTitle,
            student_code: code,
            question: `Hãy giải thích đoạn code ${language || ''} dưới đây cho một người đang học lập trình: nó làm gì, từng phần hoạt động thế nào, và khi nào thì nên dùng.`,
            history: [],
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          setError(t('failed'));
          setStreaming(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            processEvent(raw);
          }
        }
        flushPending();
        setStreaming(false);
      } catch (e) {
        flushPending();
        if ((e as Error).name !== 'AbortError') setError(t('failed'));
        setStreaming(false);
      }
    })();

    return () => ctrl.abort();
    // We intentionally re-run on every open+code change so re-opening the
    // drawer on a different snippet kicks off a fresh explanation.
    // flushPending / scheduleFlush only touch refs + setState (both stable),
    // so the linter's dep warning is a false positive here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code, language, lessonId, lessonTitle, t]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop — clicking closes. */}
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      {/* Drawer panel, slides in from the right. */}
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col border-l border-border shadow-2xl"
        style={{ background: 'var(--bg-panel)' }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-base font-semibold text-text">{t('drawer_title')}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{t('drawer_subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:text-text"
          >
            {t('close')} Esc
          </button>
        </header>

        <div className="border-b border-border p-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <span>{language || 'code'}</span>
          </div>
          <pre
            className="max-h-[35vh] overflow-auto rounded-box p-3 text-xs leading-relaxed"
            style={{
              background: 'var(--bg-code)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              fontFamily: "'Fira Code', monospace",
            }}
          >
            <code>{code}</code>
          </pre>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {streaming && !explanation ? (
            <p className="text-sm text-text-muted">{t('thinking')}</p>
          ) : null}
          {error ? (
            <p className="text-sm" style={{ color: '#ff6b6b' }}>
              {error}
            </p>
          ) : null}
          {explanation ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-text">
              {explanation}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
