/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ['./index.js'],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  rules: {
    '@typescript-eslint/no-useless-constructor': 'off',
    '@typescript-eslint/parameter-properties': 'off',
  },
};
