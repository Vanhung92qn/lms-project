/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ['./index.js', 'next/core-web-vitals'],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  rules: {
    'react/no-unescaped-entities': 'off',
  },
};
