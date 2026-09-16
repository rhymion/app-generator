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
    files: ["utils/scripts/**", "code_generator/**", "cypress/**", "cypress.config.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-namespace": "off",
    },
  },
  // cmd_607: Chai getter-style assertions (`expect(x).to.be.true`,
  // `.to.exist`) are property accesses, not function calls — TS-ESLint's
  // no-unused-expressions has no notion of Chai's assertion-chain side
  // effects, so it flags every one of them as a dead expression statement.
  // This is a well-known false positive in the eslint+chai ecosystem
  // (normally solved with eslint-plugin-chai-friendly); the assertions
  // themselves are correct and intentional, so the rule is disabled only
  // for the API e2e specs where this pattern appears.
  {
    files: ["cypress/e2e/api/**/*.cy.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  // eslint-config-next's no-unused-vars default doesn't recognize the
  // repo-wide `_`-prefix convention for intentionally-unused bindings
  // (mock-function type params, override-hook stub args, destructuring
  // placeholders) — every `_foo` in the codebase was warning alongside
  // genuinely dead code, burying the latter (cmd_529).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
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
    // Mention-gate fixture check (cmd_535) scratch output — rebuilt from
    // code_generator/tests/fixtures/mention_gate/ on every
    // scripts/check_mention_gate_fixture.sh run, gitignored, never part of
    // the shipped product.
    ".generated-mention-gate/**",
    // Mention-gate-plain-image fixture check (cmd_803) scratch output —
    // sibling of the above, rebuilt from
    // code_generator/tests/fixtures/mention_gate_plain_image/ on every
    // scripts/check_mention_gate_plain_image_fixture.sh run.
    ".generated-mention-gate-plain-image/**",
    // OTO-mandatory-gate fixture check (cmd_704 [2-a]) scratch
    // output — rebuilt from code_generator/tests/fixtures/oto_mandatory/ on
    // every scripts/check_oto_mandatory_gate_fixture.sh run, gitignored,
    // never part of the shipped product.
    ".generated-oto-mandatory-gate/**",
    // The rest of the fixture-gate scratch outputs (same shape as the two
    // above — rebuilt by their own scripts/check_*_gate_fixture.sh,
    // gitignored, never part of the shipped product). Missing here meant
    // `npm run lint` picked up whatever gate fixtures had last been run
    // locally, in violation of the gate's own "must match CI's Lint job
    // precondition" rule (see .claude/commands/update-generator.md's
    // Step 1 note) — noticed while running the gate for the user.image
    // direct-FK migration, unrelated to that change itself.
    ".generated-decimal-gate/**",
    ".generated-oto-decimal-gate/**",
    ".generated-chart-decimal-gate/**",
    ".generated-chart-scalar-gate/**",
    ".generated-approval-lockdown-gate/**",
    ".generated-payment-gate/**",
    ".generated-direct-attachment-gate/**",
    ".generated-uri-kind-gate/**",
    // Local Python virtualenv (code_generator/tests pytest deps) — never
    // part of the shipped product, and not every contributor even has one.
    ".venv/**",
  ]),
]);

export default eslintConfig;
