# Logging

Application code does not call `console.*`. It logs through `lib/logger.ts`, which redacts what it is given before anything reaches the process output.

```ts
import { logger } from '@/lib/logger';

logger.error('[orders] export failed', err);              // Error objects are safe to pass
logger.warn('[webhook] rejected', { headers, body });      // so are request headers and bodies
```

`logger.debug`, `logger.info`, `logger.warn` and `logger.error` take the same arguments as the matching `console` method and call it with the redacted values, so hosting log drains keep working unchanged. The module has no server-only imports and also works in client components (`app/**/error.tsx`).

## What is redacted

| Input | Result |
|---|---|
| An object key whose name looks like a credential (`password`, `token`, `secret`, `authorization`, `cookie`, `apiKey`, `privateKey`, `key`, ...), at any depth, in any case or separator style (`x-api-key`, `API_KEY`, `apiKey`) | the value becomes `[REDACTED]` |
| An email address anywhere inside a string value or message | `[REDACTED:email]` |
| A `Bearer ...` value or a JSON Web Token inside a string | `Bearer [REDACTED]`, `[REDACTED:jwt]` |
| An `Error` | `{ name, message, stack, cause, ...own fields }`, each redacted by the same rules |
| A cycle, or nesting deeper than 8 levels | `[Circular]`, `[Truncated]` |

Redaction is a safety net, not a licence to log request data. Prefer logging identifiers and error classes over payloads.

## Extending the rules

The rules are data in `lib/logger-redaction-rules.ts`: `REDACTED_KEY_FRAGMENTS` (matched inside the normalized key), `REDACTED_KEY_EXACT` (short names that must match whole) and `REDACTED_VALUE_PATTERNS` (regular expressions applied to string values). Add an entry and a case in `lib/logger.test.ts`; no code changes are needed.

## The no-console rule

Three checks, all part of the update-generator gate:

- `npm run lint` fails on a direct `console.*` call in hand-written code (ESLint `no-console`).
- `npm run check:generated` (rule `console:direct`) fails on a direct `console.*` call in the generated files; its `check_generated_allowlist.yaml` is the exemption list, each entry with a reason.
- `code_generator/tests/test_no_raw_console_in_templates.py` (in `npm run test:pytest`) fails on a template that calls `console.*`.

The allowlist lives in `eslint.config.mjs` (and `ALLOWED` in that test). An entry is justified only where the console is that code's actual interface and no request, user or secret data can reach it:

- `lib/logger.ts` itself;
- `scripts/**` and `utils/scripts/**`: command-line tools and gate scripts that print to a terminal and never run in a request handler;
- `code_generator/**`: generator tooling, tests and fixtures, which do not ship in a generated app;
- `cypress/**` and `cypress.config.ts`: the test runner;
- the generated Expo app (`mobile/**`), which is a separate project that runs on the device and has no shared server log.

A consumer app can reuse the same rule and allowlist; keep new entries narrow and give each a reason.
