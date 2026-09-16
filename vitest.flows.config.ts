import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['test/flows/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
    sequence: {
      concurrent: false,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
