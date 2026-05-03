import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    languageOptions: {
      parserOptions: {
        extraFileExtensions: ['.svelte'],
      },
    },
    rules: {
      // Relax rules that would flag too much existing code
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-case-declarations': 'off',
      'no-fallthrough': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'svelte/require-each-key': 'off',
      'svelte/prefer-svelte-reactivity': 'off',
      'svelte/no-unused-svelte-ignore': 'off',
      'svelte/infinite-reactive-loop': 'off',
      'svelte/no-immutable-reactive-statements': 'off',
      'svelte/no-reactive-reassign': 'off',
      'no-irregular-whitespace': 'off',
      'no-console': 'off',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
    rules: {
      // typescript-eslint 8.x can crash on Svelte 5 AST fragments for this
      // rule under ESLint 10. Keep TS/JS unused checks enabled elsewhere and
      // let svelte-check cover Svelte component diagnostics.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'src-tauri/',
      'build/',
      'electron/',
      'server/',
      'public/',
    ],
  },
);
