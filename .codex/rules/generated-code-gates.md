# Generated-code prerequisites for gates

When running lint, typecheck, or other gates in isolation (not via
`npm run test:e2e:build` which already includes `generate-code`):

1. Run `npm run generate-code` first to materialize entity code.
2. Run your gate command.
3. After PASS, restore the working tree (generated files should remain
   untracked per `.gitignore` — do not stage or commit them).
4. Never commit generated code. Use `npm run check:generated` to verify.

False-positive TS errors (caused by missing generated imports) disappear
after `generate-code`. Errors that persist are real and must be fixed.

See AGENTS.md §Generated-code prerequisites for gates for full details.
