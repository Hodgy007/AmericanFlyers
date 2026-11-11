// Lint: the TypeScript compiler (strict) already checks types; this catches what it doesn't,
// such as unused code, accidental `any`, and promises nobody waits for.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'public/', 'test-results/', 'playwright-report/', 'scripts/.cache/', '.claude/', '.vercel/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'api/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // A promise that is neither awaited nor marked `void` hides failures (a save that silently didn't happen).
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-control-regex': 'off', // the text sanitisers match control characters on purpose
      'no-useless-assignment': 'off', // flags deliberate defaults such as `let ok = false; try { ok = await … } catch { ok = false; }`
      'no-undef': 'off', // TypeScript checks this, and knows the browser and Node globals
      'no-empty': ['error', { allowEmptyCatch: true }], // `catch { /* fine */ }` is this codebase's way of saying a failure doesn't matter
    },
  },
  // Existing dynamic field access in the workout creator and the AI function's validated payload; new code elsewhere must be typed.
  { files: ['src/workouts/ui.ts', 'api/_lib/handler.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  // Tests build fakes of browser and Bluetooth objects, where `any` is the honest type.
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
