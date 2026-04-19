// Root-level ESLint sentinel. Each workspace has its own config; this file
// exists so running `eslint .` at the repo root doesn't crash on bare files.
module.exports = {
  root: true,
  ignorePatterns: ['**/*'], // workspaces own their linting
};
