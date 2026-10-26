import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// One config for the whole workspace. `projectService` finds the nearest tsconfig.json
// of each file (apps/web, packages/schema, packages/ingest).
export default tseslint.config(
  { ignores: ['**/dist'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  prettier,
  {
    rules: {
      // SVG geometry is built from numbers in template strings.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true },
      ],
    },
  },
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // These check untyped JSON at runtime, so guards on already-narrow types are the point.
    files: ['apps/web/src/data/data.test.ts', 'apps/web/src/data/validate.test.ts'],
    rules: { '@typescript-eslint/no-unnecessary-condition': 'off' },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.{js,mjs}', 'apps/web/vite.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: [
      'apps/web/scripts/**',
      'apps/web/vite.config.ts',
      'packages/*/src/**',
      'eslint.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
);
