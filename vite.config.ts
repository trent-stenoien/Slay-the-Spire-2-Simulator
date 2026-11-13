import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /<Repo-Name>/ (case-sensitive). A relative base works under any repo name.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    globals: true,
    include: ['engine/**/*.test.ts', 'data/**/*.test.ts', 'app/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
  },
});
