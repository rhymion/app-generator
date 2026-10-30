# Leak canary test

Information-leak tests that check known routes one by one cannot find a route nobody thought to check. The leak canary
puts a unique marker in every secret and searches every output for it.

`npm run test:leak-canary-gate` (`scripts/check_leak_canary_gate_fixture.sh`, step 14g of the update-generator gate, CI job
`leak-canary-gate-fixture`) builds and runs an app generated from the default schema plus the fixture schema in
`code_generator/tests/fixtures/leak_canary_gate/` (kept out of the default schema), and fails when a marker appears
where it must not. A failure names the canary (the field or variable), the surface and the route or file.

## What is declared, and where

| File | Role |
|------|------|
| `code_generator/leak_canary.yaml` | The data: `canaries` (a column or an environment variable each), `actors`, `surfaces`, `crawl`. |
| `code_generator/leak_canary.py` | Plans the markers, runs the recording proxy, scans files, gives the verdict. Names no canary, actor or surface. |
| `code_generator/tests/fixtures/leak_canary_gate/` | A fixture entity with a write-only field, the seed task, the crawl spec. |
| `code_generator/tests/test_leak_canary.py` | Unit tests, including a deliberately leaking route that must be caught. |

A marker is `CNRY<canary id><run random>`: letters and digits only, new for every run. It is searched for raw, as hex
and as base64 (in all three alignments, so a marker inside a larger encoded blob is found).

## Canaries

Database canaries are written by the seed task (`cypress/support/project-tasks.ts` of the fixture) into: the password
hash, API key and MFA secret of a user, a recovery code hash, a mobile refresh-token hash, the encrypted original name
of an attachment, a write-only field, and the title of a record of a foreign organization. Environment canaries
(`AUTH_SECRET`, `TEST_RESET_TOKEN`) are exported to the build and the running app under their own variable names.

A canary may list `allowed_actors`: a marker is then allowed in a response to that actor only. The crawl sends the
actor in an `X-Leak-Canary-Actor` request header (the proxy removes it before forwarding); a request without one is
an actor that is allowed nothing.

## Surfaces

- the proxy that fronts the app records every response: status line, headers, body; and names the export routes,
  `Content-Disposition` download names and `Location` redirect targets as their own surfaces (redirects are passed on,
  not followed);
- the server's stdout and stderr for the whole run (`server_log`);
- `.next/static` (`client_bundle`) and every emitted `*.map` (`source_map`), for the environment canaries.

## Adding to it

- a secret column: add a `canaries` entry (`table`, `column`, `row`); when the table is new, add a row factory to the
  seed task, the one place that knows a table's required columns;
- a secret environment variable: add an `env` entry with its `name`;
- an actor: add it under `actors`, then name it in `allowed_actors` or in the crawl spec's `ACTOR`;
- an output: add a `surfaces` entry (`recorder: proxy` with `header` or `path_contains`, or `recorder: file`) and, for a
  new recorder kind, the code in `leak_canary.py`.

The crawl itself reads the generated OpenAPI document, so a new entity or route is requested without any change.
