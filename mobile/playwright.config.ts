import { defineConfig } from '@playwright/test';
// Run via `npm run test:e2e:mobile:pw` (root package.json, cmd_384/DP-3
// optional gate). No webServer here by design: Expo Metro startup time and
// port conflicts are the reason this gate is optional (C3) rather than
// mandatory, so servers are started explicitly, on a port picked by the
// caller, rather than auto-started per test run. Point EXPO_WEB_URL at a
// dedicated port when running alongside another already-running mobile
// verification server (e.g. a manual PoC session) to avoid colliding with it.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.EXPO_WEB_URL ?? 'http://localhost:8081',
  },
  timeout: 60000,
});
