import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from /<repo-name>/.
export default defineConfig({
  base: '/slay-the-spire-2-simulator/',
  plugins: [react()],
  test: {
    globals: true,
    include: ['engine/**/*.test.ts', 'data/**/*.test.ts', 'app/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
  },
});
