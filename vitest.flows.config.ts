import { defineConfig } from 'vitest/config';

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
});
