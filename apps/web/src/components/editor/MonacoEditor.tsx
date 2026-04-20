'use client';

import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useState } from 'react';

// Map our 6 themes to Monaco's bundled themes. Light palettes → `vs`,
// everything else → `vs-dark`. Defining custom Monaco colour schemes per
// brand theme is a P3c polish task.
const THEME_MAP: Record<string, 'vs' | 'vs-dark'> = {
  light: 'vs',
  dark: 'vs-dark',
  dracula: 'vs-dark',
  'one-dark': 'vs-dark',
  material: 'vs-dark',
  'tokyo-night': 'vs-dark',
};

const LANGUAGE_MAP: Record<string, string> = {
  c: 'c',
  cpp: 'cpp',
  js: 'javascript',
  python: 'python',
};

export function MonacoEditor({
  value,
  onChange,
  language,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  language: 'c' | 'cpp' | 'js' | 'python';
  onSubmit?: () => void;
}) {
  const [theme, setTheme] = useState<'vs' | 'vs-dark'>('vs');

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme') ?? 'light';
    setTheme(THEME_MAP[attr] ?? 'vs');
    // Observe live theme changes from SettingsMenu (user switches mid-edit).
    const observer = new MutationObserver(() => {
      const next = document.documentElement.getAttribute('data-theme') ?? 'light';
      setTheme(THEME_MAP[next] ?? 'vs');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const handleMount: OnMount = (editor, monaco) => {
    // Ctrl/Cmd + Enter triggers submit — standard judge-site convention.
    if (onSubmit) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onSubmit());
    }
  };

  return (
    <Editor
      height="100%"
      language={LANGUAGE_MAP[language] ?? 'plaintext'}
      theme={theme}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        fontFamily: "'Fira Code', ui-monospace, monospace",
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        renderLineHighlight: 'line',
        lineNumbersMinChars: 3,
        padding: { top: 12, bottom: 12 },
      }}
    />
  );
}
