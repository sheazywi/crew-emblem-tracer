import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-tools', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser } } },
  {
    // Console-script templates: plain ES2020 that runs in someone else's page, so the safety rules
    // from docs/SECURITY.md are enforced by the linter as well as by tests/scripts.test.ts.
    files: ['src/scripts/*.template.js', 'tools/*.console.js'],
    languageOptions: {
      sourceType: 'script',
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        __DATA__: 'readonly',
        __IMG__: 'readonly',
        __OPT__: 'readonly',
        __CONTRACT__: 'readonly',
      },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-globals': [
        'error',
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'EventSource',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'eval',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'document', property: 'cookie' },
        { object: 'navigator', property: 'sendBeacon' },
        { object: 'window', property: 'fetch' },
        { object: 'window', property: 'localStorage' },
        { object: 'window', property: 'sessionStorage' },
      ],
    },
  },
  {
    files: ['*.config.{js,ts}', 'tools/**', 'e2e/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
