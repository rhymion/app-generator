// Receiver for F5 (cmd384-mobile-test-infrastructure-design.md section 3):
// logout (tab/button visible, session clears). Tracked as BACKLOG-3 — not
// yet fixed, so this file intentionally carries no test() call (see
// subtask_387b: writing the assertion now would be permanently red).
//
// Ship the spec body in the BACKLOG-3 fix cmd:
//
// import { test, expect } from '@playwright/test';
//
// test.describe('Mobile auth lifecycle: logout (BACKLOG-3)', () => {
//   test('logout clears session and returns to login', async ({ page }) => {
//     // login (see poc.spec.ts) -> click the logout tab/button -> assert
//     // the login form is visible again -> assert a subsequent reload does
//     // NOT restore the authenticated shell (refresh token was cleared).
//   });
// });
