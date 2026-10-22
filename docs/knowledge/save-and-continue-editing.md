# "Save and continue editing" button

The generated form has a second submit button beside Save. It saves the record and
keeps the user on it instead of going back to the list. After a create the URL moves from
`/new` to `/edit/[id]`, so components that the new screen does not show (attachments,
comments) can be used straight away. After an update the same edit screen reloads with
the saved values. The button's tooltip and `aria-label` are `Common.saveAndContinue`
("Save and continue editing").

## When the button is shown

| Case | Button |
|---|---|
| `x-generate.new` and `x-generate.edit` both true | shown on `/new` and on `/edit/[id]` |
| `x-generate.edit: false` | not generated (there is no `/edit/[id]` route to stay on or land on) |
| `x-generate.new: false`, `edit: true` | shown on `/edit/[id]` (it only reloads the record) |
| `x-payment` entity | not generated (a create ends at the Stripe Checkout page and the record stays provisional until paid) |
| approval-lockable entity (approvable bridge and `x-approval.submit_on`, the entities that get `edit_guard.ts`) | not generated (a save can submit the record for approval and lock it, after which the next save on the same screen would always be refused) |
| user without update permission | not shown on `/new` |

The first four rows are decided at generation time by `can_save_and_continue()` in
`generators.py`: when it is false, no continue code is emitted at all, so the generated
output for those entities is unchanged. The permission row is decided at render time:
`/edit/[id]` already requires update permission, and on `/new` the form shows the
button only when the permissions the page passes (`getXNewPageAccessCheck()`, the
general role permissions) have `update`. No new `x-*` key and no entity-name or
role-name special case is involved.

A user whose update right comes only from the Creator role (`creator.update`) has no
`general.update`, so they do not get the button on `/new`. The existing permission
check is used as is; no separate branch handles that case.

## How it works

- `FormWithChildGrid` takes an optional `continueButtonLabel`. When set it renders a second
  submit button with `name="intent" value="continue"`. Without the prop it renders exactly
  one submit button, as before.
- `FormUpsert.handleSubmit` reads `event.nativeEvent.submitter`. For the continue button
  it adds `__continue=1` to the `FormData`. Pressing Enter in a field still submits through
  the first button (Save), and the browser's own validation runs for both.
- `upsert{Parent}` reads `__continue` first. The create branch keeps the id that
  `add{Parent}()` returns. After a successful save, a continue request redirects to
  `/{parent}/edit/{id}` (a create) or to `/{parent}/edit/{id}?saved=<timestamp>` (an
  update); otherwise the action redirects to the list as before.
- A failed save (a permission, validation, conflict or reservation error) returns an
  `ActionFailure` before the redirect, so the form keeps its values and shows the error
  whichever button was used. A failed create leaves no row: `add{Parent}()` runs in one
  transaction.
- `app/[locale]/{parent}/edit/[id]/page.tsx` uses the `saved` search parameter as the
  `key` of `FormUpsert`. A new value remounts the form so every piece of its state is
  rebuilt from the saved record: the stale-write snapshot (`__src_snapshot`) matches the
  saved row, and embedded child grids, which seed their rows once from `src` and keep
  rows added in the grid under temporary ids, are re-seeded with the real ids. A plain
  `router.refresh()` would leave those temporary ids in place, and the next save would
  create the rows a second time.

REST is unchanged: `POST` already returns the new id and `PUT` has no redirect, so there is
no continue concept there.

## Tests

- `code_generator/tests/test_save_and_continue_editing.py` — the display conditions and the
  generated action, form and edit page, on `fixtures/save_continue_gate`, the x-payment
  fixture and an approval-lockable entity.
- `components/_standard/FormWithChildGrid.test.tsx` — one submit button without the label,
  two with it.
- `cypress/e2e/save_and_continue_editing.cy.ts` and `cypress/e2e/mobile/save_and_continue_editing.cy.ts` —
  the create-then-continue and edit-then-continue flows, and no button for a user without
  update permission, at desktop and phone width.
