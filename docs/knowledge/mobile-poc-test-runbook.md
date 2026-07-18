# Mobile PoC Test Runbook

## Purpose

Defines the mandatory completion gate for mobile PoC feature tasks (the
`mobile/` Expo app, e.g. auth token lifecycle, entity CRUD screens). "The
automated Playwright suite is green" is a necessary but **not sufficient**
completion signal for mobile tasks — see Background.

## Background: why automated e2e alone isn't enough

`mobile/e2e/role-crud.spec.ts` (cmd_359) launches Chromium with
`--disable-web-security` to route around a real, still-open gap: entity
REST routes (e.g. `app/api/role/route.ts`, generated from
`code_generator/templates/api_route.ts.jinja2`) send no CORS headers. Only
`/api/mobile/auth/*` has CORS headers, via `withMobileCors()`
(`lib/mobile-auth.ts`). A real browser — including `expo start --web`,
which is what a human actually opens — enforces CORS between the Expo web
origin and the Next.js API origin; the automated spec's
`--disable-web-security` workaround does not, so it cannot detect this gap.

This let cmd_366 report "PASS" while a real browser showed "Failed to load
Roles." (cmd_368 incident). cmd_368 root-caused it and demonstrated a real
fix path (a temporary same-origin proxy, below) via a bare-Chromium
Playwright script.

**cmd_369 tracks the proper fix** (a `proxy.ts`/middleware-level CORS layer
in front of `/api/*`, plus removing the `--disable-web-security` crutch
from the automated suite — design in `queue/reports/subtask_369a_gunshi.yaml`,
implementation tracked as `subtask_369b`). Before following the workaround
below literally, check whether `subtask_369b`'s report exists and its CORS
change has actually landed (design done ≠ implemented — as of cmd_370 it
was still in progress). If it has landed, entity REST routes should already
send CORS headers and the same-origin proxy step is no longer necessary;
verify directly against the app's and API's real, separate origins instead.

## Mandatory completion gate for mobile PoC tasks

1. **Automated Playwright suite** — `cd mobile && npx playwright test`.
   Existing coverage; keep it green. This alone does not prove the CORS
   gap above is absent.
2. **Real-browser verification (mandatory, cmd_370)** — before reporting a
   mobile task complete, additionally drive the flow in a Chromium session
   with *default* security (no `--disable-web-security`), against the
   origin split a human would actually see, and capture evidence (JSON
   result + screenshot) in the task report. Do not report a mobile task
   done on agent-test-green alone.

## How to run the real-browser verification

1. Start (or reuse) the Next.js app/API against `my_next_test` — this is
   now also proj_a's dev DB, see `docs/knowledge/DATABASE_TESTING.md`.
2. Start (or reuse) `npx expo start --web` for the mobile app.
3. If cmd_369's CORS fix is **not** yet live: start the same-origin proxy
   so the browser sees one origin instead of two separate ones —
   ```bash
   PROXY_PORT=8096 API_PORT=<next_port> WEB_PORT=<expo_web_port> \
     node mobile/scripts/same-origin-proxy.js
   ```
   If cmd_369 **is** live, skip this step and point `BASE_URL` below
   directly at the Expo web origin (CORS should no longer block it).
4. Run the verification script:
   ```bash
   BASE_URL=http://localhost:8096 \
     TEST_EMAIL=test@example.com TEST_PASSWORD=password123 \
     NAV_TEXT=Roles ASSERT_TEXT=Administrator \
     FORBID_TEXT="Failed to load Roles" \
     SCREENSHOT_PATH=/path/in/scratchpad/proof.png \
     node mobile/scripts/real-browser-verify.js
   ```
   Adjust `NAV_TEXT`/`ASSERT_TEXT`/`FORBID_TEXT` to the feature under test.
   Exit code is non-zero if `ASSERT_TEXT` is missing or `FORBID_TEXT` is
   present — treat that as a FAIL, not a partial pass.
5. Attach the script's JSON output and the screenshot path to the task
   report (`queue/reports/<task_id>_<worker>.yaml`).

## Process/port hygiene

- Processes started for this verification (app server, Expo web, proxy)
  are temporary. Record their ports/PIDs in your report so they don't
  become undocumented orphans — cmd_368 found exactly this: a prior
  session's Next.js dev server (pid 57617/57577) was left running,
  serving stale-but-CORS-broken data on a port later reused for
  verification.
- **Never `kill` another agent's or the Lord's existing process (D006).**
  If a leftover process needs cleanup, report it and wait for the Lord's
  or Karo's instruction — do not act unilaterally.

## Reusable scripts

- `mobile/scripts/same-origin-proxy.js` — stopgap same-origin reverse
  proxy. Superseded once cmd_369 ships a real CORS fix (see header
  comment for details and env vars).
- `mobile/scripts/real-browser-verify.js` — parameterized real-browser
  Playwright verification script (see header comment for env vars).

Both are written to be reused and extended across mobile PoC tasks, not
copy-pasted into a new one-off script each time. If a future task needs a
verification step these scripts can't express (e.g. a multi-page flow),
extend `real-browser-verify.js` rather than forking it.

## History

- cmd_359: `role-crud.spec.ts` introduced `--disable-web-security` as a
  known, documented workaround (comment in that file explains why).
- cmd_366: automated PASS did not reflect the actual browser experience —
  the CORS gap went undetected.
- cmd_368: root-caused the CORS gap via a bare-browser Playwright script
  and a temporary same-origin proxy; also found proj_a's dev DB
  (`my_next_dev`) had never actually been provisioned.
- cmd_369: generator-level CORS fix for entity REST routes (design/
  implementation in progress as of this writing — check its report before
  assuming it has landed).
- cmd_370: this runbook. Made real-browser verification a mandatory
  completion step and templated the reusable scripts above; also
  formalized dev reusing `my_next_test` as its DB (see
  `docs/knowledge/DATABASE_TESTING.md`).
