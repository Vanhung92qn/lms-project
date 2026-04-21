'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CodeExplainDrawer } from './CodeExplainDrawer';

// Wrapped fenced code block for lesson markdown. Two actions live in the
// header bar, matching the reference UI the product owner posted:
//   · Copy     — one-shot clipboard
//   · Giải thích — opens <CodeExplainDrawer> to stream an AI explanation
// Inline backtick code (no newline, no language class) bypasses the wrapper
// and renders as a plain <code> — the actions would be noise on a 3-char
// span.

interface Props {
  code: string;
  language: string; // fence lang; '' for no-language fence
  lessonId?: string;
  lessonTitle?: string;
}

export function CodeBlock({ code, language, lessonId, lessonTitle }: Props) {
  const t = useTranslations('lesson.code_block');
  const [copied, setCopied] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Older browsers / secured contexts — fall back to a manual select.
      try {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      } catch {
        /* ignore */
      }
    }
  };

  const displayLang = language || 'text';

  return (
    <>
      <div
        className="my-4 overflow-hidden rounded-box"
        style={{ background: 'var(--bg-code)', border: '1px solid var(--border-color)' }}
      >
        <div
          className="flex items-center justify-between border-b px-3 py-1.5"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {displayLang}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExplainOpen(true)}
              className="flex items-center gap-1 rounded-pill px-3 py-1 text-xs font-semibold transition-colors"
              style={{
                background: 'rgba(247, 189, 77, 0.15)',
                color: 'var(--accent)',
                border: '1px solid rgba(247, 189, 77, 0.4)',
              }}
              title={t('explain')}
            >
              <span aria-hidden>✦</span>
              <span>{t('explain')}</span>
            </button>
            <button
              type="button"
              onClick={onCopy}
              className="rounded-pill border px-2.5 py-1 text-xs text-text-muted transition-colors hover:text-text"
              style={{ borderColor: 'var(--border-color)' }}
              title={t('copy')}
              aria-label={copied ? t('copied') : t('copy')}
            >
              {copied ? '✓' : '📋'}
            </button>
          </div>
        </div>
        <pre
          className="overflow-x-auto p-4 text-sm leading-relaxed"
          style={{ color: 'var(--text-main)', fontFamily: "'Fira Code', monospace" }}
        >
          <code className={language ? `language-${language}` : undefined}>{code}</code>
        </pre>
      </div>

      <CodeExplainDrawer
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        code={code}
        language={displayLang}
        lessonId={lessonId}
        lessonTitle={lessonTitle}
      />
    </>
  );
}
