module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  plugins: ['@typescript-eslint'],
  rules: {
    // eslint-plugin-next's `no-page-custom-font` is a false positive in the
    // App Router (no pages/_document). We opt out globally; switching to
    // next/font for Outfit / Fira Code is a p1.1 task.
    '@next/next/no-page-custom-font': 'off',
    // Prefer the TS-aware rule so parameter properties in class constructors
    // (e.g. `constructor(public foo: string)`) don't trip false positives.
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
};
