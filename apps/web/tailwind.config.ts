import type { Config } from 'tailwindcss';

/**
 * Tailwind config — colors, fonts, and radii map directly onto the CSS
 * variables defined in src/styles/tokens.css. No parallel palette: Tailwind
 * classes like `bg-panel` resolve to `var(--bg-panel)` so the six-theme
 * switcher from bento.html keeps working.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        main: 'var(--bg-main)',
        panel: 'var(--bg-panel)',
        header: 'var(--bg-header)',
        code: 'var(--bg-code)',
        text: {
          DEFAULT: 'var(--text-main)',
          muted: 'var(--text-muted)',
        },
        border: 'var(--border-color)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
        },
      },
      borderRadius: {
        card: '24px',
        box: '16px',
        pill: '99px',
      },
      boxShadow: {
        soft: '0 12px 32px -20px var(--shadow-color)',
        softer: '0 4px 16px -4px var(--shadow-color)',
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['"Fira Code"', 'ui-monospace', 'monospace'],
      },
      transitionTimingFunction: {
        bento: 'ease',
      },
    },
  },
  plugins: [],
};

export default config;
