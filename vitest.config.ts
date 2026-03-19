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
    exclude: ["**/node_modules/**", "**/dist/**", "**/utils/templates/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
