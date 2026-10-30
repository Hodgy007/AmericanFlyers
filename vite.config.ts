import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /americanflyers/.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 }, // three.js is ~550 kB minified
});
