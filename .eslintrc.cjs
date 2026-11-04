module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2021: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: { jsx: true }
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'data/',
    'backups/',
    'coverage/',
    '*.d.ts',
    'package-lock.json',
    'test-results/',
    'playwright-report/',
    'blob-report/'
  ],
  rules: {
    'no-undef': 'off',
    'no-console': 'off',
    'no-control-regex': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
    ]
  },
  overrides: [
    {
      files: ['*.mjs', '*.cjs'],
      parser: 'espree',
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' }
    },
    {
      files: ['*.ts', '*.tsx'],
      rules: {
        'no-unused-vars': 'off'
      }
    }
  ]
};
