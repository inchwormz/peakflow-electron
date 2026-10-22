// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config({
  ignores: ['out/**', 'release/**', 'node_modules/**', 'dist/**', 'scripts/**', '*.config.*', 'sidecar/**']
}, {
  files: ['**/*.ts', '**/*.tsx'],
  extends: [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
  ],
  languageOptions: {
    parserOptions: {
      // tsconfig.json only holds references, so point the parser at the real projects.
      project: ['./tsconfig.node.json', './tsconfig.web.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
