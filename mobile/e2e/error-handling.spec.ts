// Receiver for F8 (cmd384-mobile-test-infrastructure-design.md section 3):
// RESTRICT-friendly error message when deleting an FK-restricted row. Not
// yet started (no BACKLOG item filed as of cmd_384), so this file
// intentionally carries no test() call — the receiving-end behavior isn't
// implemented yet, so an assertion now would be permanently red.
//
// Ship the spec body in whichever cmd implements the RESTRICT-friendly
// error message:
//
// import { test, expect } from '@playwright/test';
//
// test.describe('RESTRICT-friendly delete error', () => {
//   test('deleting an FK-restricted row shows a friendly error, not a raw 500/stack trace', async ({ page }) => {
//     // login -> nav to an entity referenced by another entity's required
//     // FK -> attempt delete -> assert a readable RESTRICT-violation
//     // message is shown (not a raw server error) -> assert the row was
//     // NOT deleted (re-fetch still shows it).
//   });
// });
