'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

interface TutorMessage {
  role: 'user' | 'assistant';
  content: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');

export function AITutorPanel({
  lessonTitle,
  source,
  lastVerdict,
  lastStderr,
}: {
  lessonTitle: string;
  source: string;
  lastVerdict: string | null;
  lastStderr: string | null;
}) {
  const t = useTranslations('tutor');
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the conversation as tokens arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Cancel any in-flight stream when this panel unmounts (e.g. navigation).
  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = async (question: string, autoIntent: boolean) => {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      token = null;
    }
    if (!token) {
      setError(t('sign_in_required'));
      return;
    }

    const history = messages.slice(-6);
    const userMsg: TutorMessage = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }]);
    setDraft('');
    setStreaming(true);
    setError(null);
    setElapsedMs(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const startedAt = performance.now();

    try {
      const res = await fetch(`${API_BASE}/ai/tutor/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          intent: autoIntent ? 'fix-error' : 'concept-explain',
          locale: 'vi',
          lesson_title: lessonTitle,
          student_code: source,
          compiler_error: lastStderr ?? undefined,
          verdict: lastVerdict ?? undefined,
          question,
          history,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        setError(`HTTP ${res.status}`);
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
        // SSE events are separated by a blank line.
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          processEvent(raw);
        }
      }
      setStreaming(false);
      setElapsedMs(Math.round(performance.now() - startedAt));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message);
      }
      setStreaming(false);
    }
  };

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
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') {
            next[next.length - 1] = { ...last, content: last.content + delta };
          }
          return next;
        });
      } catch {
        /* ignore */
      }
    } else if (event === 'error') {
      try {
        const parsed = JSON.parse(data);
        setError(parsed.message ?? 'upstream error');
      } catch {
        setError('upstream error');
      }
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q || streaming) return;
    void ask(q, false);
  };

  const onQuickAsk = () => {
    void ask(t('auto_question'), true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-code px-4 py-2">
        <span className="flex items-center gap-2 font-mono text-xs text-text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: streaming ? '#22c55e' : 'var(--text-muted)' }} />
          {streaming ? t('thinking') : 'AI Tutor · llama3:8b'}
        </span>
        {elapsedMs != null ? (
          <span className="text-[10px] text-text-muted">{(elapsedMs / 1000).toFixed(1)}s</span>
        ) : null}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-text-muted">
            <p>{t('empty_hint')}</p>
            {(lastVerdict && lastVerdict !== 'ac' && lastVerdict !== 'pending') ? (
              <button
                type="button"
                onClick={onQuickAsk}
                disabled={streaming}
                className="rounded-pill bg-accent px-4 py-2 text-xs font-semibold text-panel transition-colors hover:bg-accent-hover"
              >
                {t('ask_about_verdict', { verdict: lastVerdict.toUpperCase() })}
              </button>
            ) : null}
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-box px-3 py-2 ${
                m.role === 'user'
                  ? 'ml-auto max-w-[80%] bg-accent text-panel'
                  : 'max-w-[90%] bg-code text-text'
              }`}
            >
              <p className="whitespace-pre-wrap leading-relaxed">
                {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
              </p>
            </div>
          ))
        )}
        {error ? (
          <p className="rounded-box bg-code px-3 py-2 text-xs" style={{ color: '#ff6b6b' }}>
            {error}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t border-border bg-panel p-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('input_placeholder')}
          disabled={streaming}
          className="input flex-1 rounded-pill !py-2 text-sm"
        />
        <button
          type="submit"
          disabled={streaming || !draft.trim()}
          className="rounded-pill bg-accent px-4 py-2 text-xs font-semibold text-panel transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {t('send')}
        </button>
      </form>
    </div>
  );
}
