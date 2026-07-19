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

**Status as of cmd_384/subtask_387b: fixed.** cmd_369/374 landed the CORS fix
(entity REST routes now send CORS headers via the generalized proxy —
`lib/mobile-auth.ts` / `withMobileCors()`), and the `--disable-web-security`
crutch has been fully removed from the automated suite (confirmed by grep
across `mobile/` and `cypress/` — zero occurrences other than explanatory
comments in `real-browser-verify.js` documenting why it must stay absent).
The same-origin proxy step (3 below) is no longer needed — point `BASE_URL`
directly at the Expo web origin. **Do not reintroduce
`--disable-web-security`** in any new spec or script; that is exactly the
gap this runbook's real-browser check exists to catch.

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
3. Point `BASE_URL` directly at the Expo web origin — the cmd_369/374 CORS
   fix is live, so the same-origin proxy (`same-origin-proxy.js`) is no
   longer needed for this step. It remains available for a future origin
   split that reintroduces a CORS gap, but do not reach for it by default.
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
  proxy. Superseded now that cmd_369/374 shipped the real CORS fix (see
  Background above); kept for reference only.
- `mobile/scripts/real-browser-verify.js` — parameterized real-browser
  Playwright verification script, selected via the `FLOW_TYPE` env var
  (see header comment for the full list and env vars):
  - `FLOW_TYPE=assert` (default) — login + optional nav + assert/forbid
    text. The original single-shot shape (subtask_368a and on).
  - `FLOW_TYPE=create-picker` — login → nav → create → fill → pick →
    save → assert new row. Replaces the old `permission-picker-verify.js`
    (deleted subtask_387b; call with `FLOW_TYPE=create-picker` instead).
  - `FLOW_TYPE=edit-picker` — login → nav → open row → Edit → assert
    picker preloaded → edit → save → assert persisted → reopen. Replaces
    the old `role-picker-verify.js` (deleted subtask_387b; call with
    `FLOW_TYPE=edit-picker` instead).

**Convention (DP-4, cmd_384): do not fork this file.** A new mobile
verification need that doesn't fit an existing `FLOW_TYPE` gets a new
preset added to `real-browser-verify.js`, not a new one-off script. This
reversed the drift that had already produced two near-duplicate scripts
(`permission-picker-verify.js`, `role-picker-verify.js`) before cmd_384;
both were folded back in and deleted.

## Mobile automated test infrastructure (cmd_384/subtask_387b)

Design doc (SoT): `~/work/app-generator-project-docs/planning/cmd384-mobile-test-infrastructure-design.md`.
Lord's ruling (2026-07-19): all four decision points approved as recommended.

- **DP-1 — curated hand-written specs, not generator-driven.** `mobile/e2e/`
  stays a hand-written, feature/flow-clustered spec suite (like
  `poc.spec.ts`, `role-crud.spec.ts`), not a per-entity generator template.
  **Every BACKLOG-MOBILE fix cmd must ship at least one Playwright spec
  covering that fix** — this is the mobile app's functional gate, the
  equivalent of the web app's `test:e2e:cy:api`. Re-evaluate a
  generator-driven approach only after all BACKLOG-MOBILE items have
  curated specs and the mobile nav's entity set has stabilized.
- **DP-2 — Playwright is primary (Layer 1, required); jest is secondary
  (Layer 2, optional).** `mobile/e2e/*.spec.ts` covers full user flows
  end-to-end and is the layer that must exist for a BACKLOG fix to count
  as tested. `mobile/**/*.test.tsx` (jest-expo, zero specs so far) is
  optional — add it for non-trivial component logic in isolation (e.g.
  `MobilePicker.tsx`'s null-clear behavior), not as a substitute for the
  Playwright flow.
- **DP-3 — gate is optional (C3) now, promotes to mandatory (C2) later.**
  `npm run test:e2e:mobile:pw` (root `package.json`) runs the mobile
  Playwright suite. It is **not** wired into any mandatory gate (not part
  of `test:e2e:cy:api` or any aggregate `test:e2e*` script) — run it
  per-cmd, recommended by Karo, not enforced by CI. Rationale: Expo Metro
  startup time and port conflicts make it flaky enough that a hard gate
  today would produce false-negative blocks. **Promote to mandatory (C2)
  after BACKLOG-MOBILE items 1–3 land** and coverage reaches the ~6-flow
  mark the design doc targets; that promotion is a separate future cmd, not
  done here.
- **DP-4 — `real-browser-verify.js` FLOW_TYPE extension, no forking.** See
  "Reusable scripts" above.

### Running the gate

```bash
# Uses mobile/playwright.config.ts's EXPO_WEB_URL default (localhost:8081)
npm run test:e2e:mobile:pw

# Isolated run against a dedicated port, e.g. so it doesn't collide with a
# manual verification server already running on the default port:
EXPO_WEB_URL=http://localhost:8161 npm run test:e2e:mobile:pw
```

No `webServer` auto-start is configured in `mobile/playwright.config.ts` —
start the Next.js app and `expo start --web` yourself first (same as the
real-browser verification steps above), on whatever port you point
`EXPO_WEB_URL` at. This keeps the gate's CI overhead low (DP-3's Low/C3
column) and avoids Metro-boot flakiness inside the test run itself.

### Coverage map and receiver files

| Flow | Spec | Status |
|---|---|---|
| F1 Login | `poc.spec.ts` | ✅ implemented |
| F2 Refresh token survives reload | `poc.spec.ts` | ✅ implemented |
| F3 Entity list read | `role-crud.spec.ts` | ✅ implemented |
| F4 Edit → save → persists | `role-crud.spec.ts` | ✅ implemented |
| F5 Logout | `auth-lifecycle.spec.ts` | receiver only (BACKLOG-3) |
| F6 FK picker select + clear-to-null | `picker.spec.ts` | receiver only (BACKLOG-1) |
| F7 Enum field dropdown | `enum-field.spec.ts` | receiver only (BACKLOG-2) |
| F8 RESTRICT-friendly delete error | `error-handling.spec.ts` | receiver only (not started) |
| F9 Permission-gated UI | `permissions-gating.spec.ts` | receiver only (BACKLOG-4) |
| F10 m2m picker | `picker.spec.ts` | receiver only (promote from FLOW_TYPE=edit-picker script coverage) |

The five receiver files above (added subtask_387b) intentionally contain
**no `test()` call** — only a commented-out skeleton and a pointer to the
BACKLOG item that unblocks it. Writing a real assertion against a feature
that isn't fixed yet would just pin the suite red; the BACKLOG fix cmd
fills in the real body (per DP-1) when it lands.

### Native platform dead angle

The entire `mobile/e2e/` suite drives the Expo **web** bundle
(react-native-web via Expo Metro), i.e. standard Chromium — never iOS/
Android native rendering. The clearest blind spot: generated delete
confirmation uses `window.confirm` on web but `Alert.alert(...)` natively
(`Platform.OS === 'web'` branch in `mobile/app/(app)/{entity}/[id].tsx`,
see cmd_371). **`Alert.alert` is entirely invisible to Playwright** — a
regression in the native delete-confirm path would not be caught by this
suite. Native coverage (Detox/Maestro against an emulator) is a separate,
lower-priority infrastructure investment (see design doc section 4); until
then, note the native-alert gap explicitly in any cmd whose QC touches
delete confirmation.

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
- cmd_369/374: generator-level CORS fix for entity REST routes landed;
  `--disable-web-security` fully removed from the automated suite.
- cmd_376: `mobile/scripts/permission-picker-verify.js` and
  `role-picker-verify.js` added as purpose-built companion scripts for
  FK/m2m picker flows (see their own history, since superseded).
- cmd_384/subtask_387b: base test infrastructure per Lord's DP-1–4 ruling —
  `test:e2e:mobile:pw` optional (C3) gate, `permission-picker-verify.js`/
  `role-picker-verify.js` folded into `real-browser-verify.js`'s
  `FLOW_TYPE` and deleted, five receiver spec files added for the
  still-broken BACKLOG-MOBILE flows (F5–F9), this section documenting
  DP-1 through DP-4.
