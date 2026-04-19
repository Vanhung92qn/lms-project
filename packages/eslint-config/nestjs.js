/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ['./index.js'],
  // Intentionally NOT setting parserOptions.project — type-aware rules are
  // off for MVP, so we avoid the cost of parsing the full TS project for
  // every lint run. Re-enable when we adopt rules like no-floating-promises.
  rules: {
    '@typescript-eslint/no-useless-constructor': 'off',
    '@typescript-eslint/parameter-properties': 'off',
  },
};
