// Receiver for F9 (cmd384-mobile-test-infrastructure-design.md section 3):
// permission-gated UI — CUD buttons hidden without the relevant permission.
// Tracked as BACKLOG-4 — not yet fixed, so this file intentionally carries
// no test() call (see subtask_387b: writing the assertion now would be
// permanently red).
//
// Ship the spec body in the BACKLOG-4 fix cmd:
//
// import { test, expect } from '@playwright/test';
//
// test.describe('Permission-gated UI (BACKLOG-4)', () => {
//   test('CUD buttons hidden for a user without the relevant permission', async ({ page }) => {
//     // login as a user with read-only permission on an entity -> nav to
//     // its list/detail -> assert Create/Edit/Delete controls are absent
//     // (not just disabled) -> login as an Administrator -> assert they
//     // ARE present, to prove this is gating, not a rendering bug.
//   });
// });
