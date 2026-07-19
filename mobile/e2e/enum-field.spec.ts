// Receiver for F7 (cmd384-mobile-test-infrastructure-design.md section 3):
// enum field renders as a dropdown/picker, not raw text. Tracked as
// BACKLOG-2 — not yet fixed, so this file intentionally carries no test()
// call (see subtask_387b: writing the assertion now would be permanently
// red).
//
// Ship the spec body in the BACKLOG-2 fix cmd:
//
// import { test, expect } from '@playwright/test';
//
// test.describe('Enum field: dropdown, not raw text (BACKLOG-2)', () => {
//   test('enum field shows a dropdown/picker of labeled options', async ({ page }) => {
//     // login -> nav to an entity with an enum field -> open create/edit ->
//     // assert the field renders as a picker/dropdown (not a free-text
//     // input) -> select an option -> save -> re-fetch -> assert the
//     // formatted enum label (not the raw enum constant) is shown.
//   });
// });
