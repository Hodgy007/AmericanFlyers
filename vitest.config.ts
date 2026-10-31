import { defineConfig } from 'vitest/config';

// Unit tests for the pure logic in src/ (no browser, no WebGL). Files that need
// a DOM (DOMParser for .zwo / GPX) opt in with `// @vitest-environment jsdom`.
export default defineConfig({
  define: { __SENTRY_DSN__: JSON.stringify(''), __RELEASE__: JSON.stringify('') },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
