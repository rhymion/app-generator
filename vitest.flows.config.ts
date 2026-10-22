import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['test/flows/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
    // The flows share one database and one set of ports, and some of them (for
    // example the audit log operations flow) require running one file at a time.
    fileParallelism: false,
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
