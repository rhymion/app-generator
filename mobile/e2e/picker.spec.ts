// Receiver for F6 + F10 (cmd384-mobile-test-infrastructure-design.md
// section 3): FK picker select + clear-to-null (BACKLOG-1), and promoting
// the m2m picker script coverage (permission-picker-verify.js /
// role-picker-verify.js, now real-browser-verify.js FLOW_TYPE=create-picker
// / FLOW_TYPE=edit-picker — see mobile/scripts/real-browser-verify.js) to a
// standing Playwright spec. BACKLOG-1 isn't fixed yet, so this file
// intentionally carries no test() call (see subtask_387b: writing the
// null-clear assertion now would be permanently red).
//
// Ship the spec body in the BACKLOG-1 fix cmd:
//
// import { test, expect } from '@playwright/test';
//
// test.describe('FK/m2m picker (BACKLOG-1)', () => {
//   test('can clear a set FK back to null', async ({ page }) => {
//     // login -> nav to an entity with an FK picker -> open a row with the
//     // FK set -> open the picker -> clear selection -> save -> re-fetch ->
//     // assert the FK reads as unset, not silently unchanged.
//   });
//
//   test('m2m picker: select multiple, save, re-fetch shows all selections', async ({ page }) => {
//     // Promote real-browser-verify.js FLOW_TYPE=edit-picker's role/users
//     // flow (F10) into a standing regression spec here.
//   });
// });
