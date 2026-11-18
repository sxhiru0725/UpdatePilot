import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/dist/**',
      '**/next-env.d.ts',
      '**/.local/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        FormData: 'readonly',
        RequestInit: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        TextDecoder: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
