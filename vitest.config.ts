import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'mail-server/apps/webmail'),
    },
  },
  test: {
    css: true,
    environment: 'jsdom',
    globals: true,
    include: ['mail-server/apps/webmail/test/**/*.test.ts?(x)'],
    maxWorkers: 1,
    minWorkers: 1,
    setupFiles: ['mail-server/apps/webmail/test/setup.ts'],
  },
});
