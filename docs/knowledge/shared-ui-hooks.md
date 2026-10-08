# Shared UI Hooks

Each generated entity screen keeps its state, submit orchestration, permission-derived
show/hide decisions and approval wiring in three small modules under `lib/{entity}/`. The Web
screens (`FormUpsert.tsx`, `FormView.tsx`) call them; another client that renders the same
entity screens can import the same modules and supply its own rendering, routing and transport.

The business logic itself is not in these modules. Writes go through `lib/{entity}/service.ts`,
which the Server Action (`actions.ts`) and the REST routes both call, and client-side input
validation is the pure `components/{entity}/form_validation.ts`.

## Modules

| Module | Generated when | Contents |
|---|---|---|
| `lib/{entity}/use_entity_form.ts` | the entity has a create or edit form | `useEntityForm()` hook, `getEntityFormErrorMessage()` |
| `lib/{entity}/use_entity_capabilities.ts` | the entity has a create, edit or view screen | `resolveEntityCapabilities()`, `useEntityCapabilities()` |
| `lib/{entity}/use_entity_approval_actions.ts` | the entity's view renders `ApprovalSection` (`x-custom-components`) | `useEntityApprovalActions()`, `HAS_ON_WITHDRAWN`, re-exports of the approval predicates |

None of them imports `next/*`, `next-intl`, a UI library or a DOM API. `react` is the only
runtime import. Everything platform-specific is passed in by the caller.

### `useEntityForm({ translators, save })`

- `translators` is `{ terr, tmsg }`: a translator scoped to the `Errors` namespace and the root
  translator (which also exposes `has(key)`). On the Web these are the `next-intl` translators.
- `save(formData)` persists the form and returns `ActionFailure | ActionCreated | void`. On the Web
  it is the entity's `upsert` Server Action.
- Returns `{ isPending, error, setError, validationError, getErrorMessage, validate, submit }`.
  - `validate(run)` calls the validator (`run` returns a message or `null`), records the message in
    `validationError` and returns whether the form may be submitted.
  - `submit(formData, onCreated?)` calls `save` inside a transition. A failure result becomes
    `error`; a created-record result (`{ ok: true, id }`) goes to `onCreated(id)`, which the form
    passes only when it is an `x-create-inline` dialog.
- `getEntityFormErrorMessage(err, translators)` is the pure mapping from an `ActionFailure` to
  its i18n message (see `error-message-framework.md`). For an entity that declares
  `x-exclusive-parents`, the module also names every listed column in the exclusive-parents error.

The Web `FormUpsert` keeps building the `FormData` (field values, child grids) and handling the
submit event, because both depend on the screen's own components.

### `resolveEntityCapabilities({ permissions, isEdit, inDialog })`

Pure. Returns `{ canDelete, canEdit, canContinue }`:

- `canDelete` is `permissions.delete`, or `true` when no permissions object is given.
- `canEdit` is `permissions.update ?? true`, and the constant `false` for `x-generate.edit: false`
  (the entity has no update path, so RBAC can never re-enable an edit affordance).
- `canContinue` ("Save and continue editing") is `!inDialog && (isEdit || Boolean(permissions?.update))`
  for entities that offer the button, and `false` otherwise.

`useEntityCapabilities()` is the hook form of the same function.

### `useEntityApprovalActions(...)`

Binds the entity's approval declarations to the shared `ApprovalSection`:

- `hasOnWithdrawn` mirrors whether the entity declares `x-approval.on_withdrawn`
  (`HAS_ON_WITHDRAWN`). The server-side withdraw lockout rejects a withdrawal when it is `false`,
  so the shared component hides the button.
- For an entity that can be submitted for approval, the hook takes `{ recordId, submit }` and
  returns `onSubmitForApproval`, which calls `submit(recordId)`. On the Web `submit` is the entity's
  `submitForApproval` Server Action.

The module re-exports `canSubmitForApproval`, `canWithdrawApproval` and `canActOnApprovalRequest`
from `lib/approval_request/submit_predicate.ts`. `canActOnApprovalRequest(request, actionable,
currentUserRoleIds, flowIdToStatus)` decides whether the current user may approve or reject one
request row: the row belongs to the current round, it is pending, the user holds the approver
role and every preceding stage is approved in this round. `ApprovalSection` calls it for each row.

## Tests

- `code_generator/tests/test_shared_ui_hooks.py` checks where each module is generated, that none
  imports a platform module, and that the Web screens call them.
- `lib/approval_request/submit_predicate.test.ts` covers `canActOnApprovalRequest`.
