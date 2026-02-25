import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-plugin-react@7.37.5 uses context.getFilename() which was removed in ESLint 9.
  // Disable the affected rules until eslint-plugin-react ships a fix.
  {
    rules: {
      "react/display-name": "off",
      "react/jsx-filename-extension": "off",
      "react/no-direct-mutation-state": "off",
      "react/no-render-return-value": "off",
      "react/no-string-refs": "off",
      "react/prefer-stateless-function": "off",
      "react/require-render-return": "off",
    },
  },
  // Generator scripts and Cypress test infrastructure — relax strict TS rules.
  {
    files: ["utils/scripts/**", "cypress/**", "cypress.config.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-namespace": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated coverage report — never lint:
    "coverage/**",
  ]),
]);

export default eslintConfig;
