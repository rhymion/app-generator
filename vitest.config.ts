import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// lib/dashboard/{catalog,access-scope}.ts are generated and gitignored, so a checkout without
// generate-code (the CI Unit Tests job) cannot resolve them. Unit tests mock both modules, but
// Vite's import analysis still needs the specifier to resolve, so fall back to an empty stub
// only when the generated file is missing; a generated file always wins.
const DASHBOARD_GENERATED_STUBS: Record<string, string> = {
  "./catalog": "test/stubs/dashboard-catalog.ts",
  "./access-scope": "test/stubs/dashboard-access-scope.ts",
};
const dashboardDir = path.resolve(__dirname, "lib/dashboard") + path.sep;
const dashboardGeneratedFallback = {
  name: "dashboard-generated-fallback",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    const stub = DASHBOARD_GENERATED_STUBS[source];
    if (!stub || !importer || !importer.startsWith(dashboardDir)) return null;
    if (fs.existsSync(path.resolve(dashboardDir, `${source}.ts`))) return null;
    return path.resolve(__dirname, stub);
  },
};

// The resolveId decision above depends on whether the generated files exist, but Vitest's
// on-disk transform cache is not keyed on it. A cache written while the files were absent
// (e.g. an earlier run before generate-code) keeps the stub-resolved import of ./catalog, so
// after generate-code vi.mock('./catalog') no longer matches and the dashboard tests fail with
// a TypeError (Issue #1185). Give each generated/stub state its own cache directory so a cache
// never outlives the state it was written under.
const dashboardGeneratedState = Object.keys(DASHBOARD_GENERATED_STUBS)
  .map((source) => (fs.existsSync(path.resolve(dashboardDir, `${source}.ts`)) ? "1" : "0"))
  .join("");

// prj:sync lists generator tests whose script the consumer replaces (Issue #1070); a
// checkout that never ran prj:sync has no list, so every generator test runs.
function prjSyncExcludedTests(): string[] {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, ".prj-sync-excluded-tests.json"), "utf-8"),
    );
    return Array.isArray(parsed.tests) ? parsed.tests.filter((t: unknown) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export default defineConfig({
  plugins: [react(), dashboardGeneratedFallback],
  test: {
    typecheck: { tsconfig: "./tsconfig.test.json" },
    fsModuleCachePath: path.resolve(
      __dirname,
      "node_modules",
      ".vitest-cache",
      `dashboard-generated-${dashboardGeneratedState}`,
    ),
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
      // Expo mobile app (generated) and its Playwright specs: separate project, own runner.
      "mobile/**",
      "**/dist/**",
      "**/utils/templates/**",
      // dev-full.test.ts: CI integration test requiring full docker stack + generate-code run.
      // cleanup.test.ts: excluded from normal suite because cleanup:all deletes
      //   lib/dashboard/catalog.ts, causing subsequent DashboardWidget.test imports to fail.
      //   Re-enable in isolated run (e.g. npm run test:flows) after ensuring catalog.ts exists.
      "**/test/flows/**",
      // x-payment gate fixture: run by scripts/check_payment_gate_fixture.sh
      // against generated code, with its own config (and the copy it stages
      // under .generated-payment-gate/).
      "code_generator/tests/fixtures/payment_gate/**",
      ".generated-payment-gate/**",
      // Attachment bridge ownership fixture: run by
      // code_generator/tests/test_attachment_actions.py against the rendered
      // template, with its own config (and the copy it stages under
      // .generated-attachment-bridge-test/).
      "code_generator/tests/fixtures/attachment_bridge_actions/**",
      ".generated-attachment-bridge-test/**",
      // Generator tests of a script the consumer's prj/ replaces (written by prj:sync).
      ...prjSyncExcludedTests(),
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
