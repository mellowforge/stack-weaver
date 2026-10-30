import { defineConfig } from 'vite';

// Dev playground only (`pnpm dev`); the library itself is built with tsc.
export default defineConfig({
  root: 'examples',
  server: { port: 5173 },
});
