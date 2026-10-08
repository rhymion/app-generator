import { defineConfig } from '@playwright/test';

// Run with `npm run test:e2e:mobile:pw` from the repository root.
//
// No webServer is configured on purpose: the stack is three processes (the
// Next.js API, the Expo web dev server and the same-origin proxy that joins
// them) and Metro start-up time and port conflicts make auto-starting them
// per run unreliable. Start them explicitly on ports you pick, then point
// EXPO_WEB_URL at the proxy port. See docs/knowledge/mobile-app.md.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.EXPO_WEB_URL ?? 'http://localhost:8081',
  },
  timeout: 60000,
});
