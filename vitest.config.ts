import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    typecheck: { tsconfig: "./tsconfig.test.json" },
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        inline: ["@mui/material", "@mui/x-data-grid"],
      },
    },
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/utils/templates/**",
      // dev-full.test.ts: CI integration test requiring full docker stack + generate-code run.
      // cleanup.test.ts: excluded from normal suite because cleanup:all deletes
      //   lib/dashboard/catalog.ts, causing subsequent DashboardWidget.test imports to fail.
      //   Re-enable in isolated run (e.g. npm run test:flows) after ensuring catalog.ts exists.
      "**/test/flows/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
