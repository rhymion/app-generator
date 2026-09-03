# Post-create side-effect hook (`afterCreate`)

## Contract

Every entity with `x-generate.new` enabled (`can_create`) gets a write-once
stub at `lib/{entity}/service_after_create.ts`:

```ts
export async function afterCreate(tx: Tx, entityId: string): Promise<void> {
  // TODO: implement post-create effects here
}
```

`add{Parent}()` (`service.ts.jinja2`) calls it **inside the same Prisma
transaction** as the row's own write, after the row (and any of its own
nested-create machinery) is fully written, right before the transaction
returns:

```ts
export async function addLeaveRequest(...) {
  return await prisma.$transaction(async (tx) => {
    const created = await tx.leave_request.create({ data: { ... } });
    // ... other post-create blocks (nested creates, reservation allocation,
    // approval edge trigger, audit event) ...
    await afterCreate(tx, created.id);
    return { id: created.id };
  });
}
```

Two consequences follow directly from being in-tx:

- **A throw inside `afterCreate` rolls back the entire create**, including
  the row `tx.{model}.create()` just wrote. This is deliberate: the row and
  its side effect must never be observed independently — a row committed
  with its side effect silently missing is the "user-invisible
  inconsistency" this hook exists to prevent (the same reasoning
  `afterApprove`'s in-tx call already applies — see
  `docs/knowledge/appendix/approval-flow.md`).
- **The hook can read/write anything already visible inside the
  transaction**, via the `tx` client it receives — including the row it was
  just called for.

The default (unedited) stub is a no-op — every entity must keep generating
correctly with zero customization. **Do not implement a default that
throws**: every `can_create` entity would break immediately after a fresh
`generate-code` run.

## Write-once, not schema-declared

`service_after_create.ts` is written with `_write_stub()` (generate.py),
the same write-once convention as `service_validation_custom.ts` and
`service_after_approve.ts` — created once, never overwritten by a later
`generate-code` run, so hand-written customization survives regeneration.
This is the opposite convention from `edit_guard.ts`/`delete_guard.ts`,
which are pure schema derivations and are **always** regenerated
(`_write()`, never `_write_stub()`).

There is no schema key to opt into this hook — it exists for every
`can_create` entity unconditionally, the same way `validateOnAdd`/
`validateOnUpdate` unconditionally call `validateCustomRules()`. Unlike
`afterApprove`/`afterReject`/`afterWithdraw` (each gated on an explicit
`x-approval.on_*.emit_hook: true` declaration), there is no opt-in flag
here — the design intentionally does not add a new `x-*` key.

## Model-keyed, not view-keyed (proxy views)

The stub file and the `afterCreate` import are both keyed by **`model`**,
not `parent`. An allOf proxy view (`model != parent`, e.g. `setting` →
`user`) has no Prisma model of its own; its `add{Parent}()` imports
`afterCreate` from `'@/lib/{model}/service_after_create'` (an absolute
`@/lib/...` path, not a relative `./...` one), the same way
`service_validation.ts` imports `validateCustomRules` from
`'@/lib/{model}/service_validation_custom'`. The stub file itself is
written once per **model** (`generate.py`'s `if model == parent:` guard,
alongside `service_validation_custom.ts`) — unconditional on that specific
entity's own `can_new`, since a different view sharing the same model may
independently declare `x-generate.new: true` even when the canonical
(`model == parent`) entity has create disabled.

## Cleanup

Unlike a truly boilerplate-invariant stub, `service_after_create.ts`'s
default body embeds the entity name in a JSDoc comment, so it cannot be
matched against a single fixed "pristine" string across every entity.
`cleanup.py` therefore treats it exactly like `service_validation_custom.ts`
— a permanent write-once file, never swept even for an orphaned entity
(neither by the regular per-entity pass nor by `--prune-orphans`). This is
a deliberate behavior change from an earlier, unrelated generation of this
same file (see "History" below), which *was* pristine-matched and
auto-deleted; that mechanism no longer applies.

## History: retirement and reinstatement

This is the second life of `lib/{entity}/service_after_create.ts`. The
first version's `afterCreate(tx, created, data)` existed solely to create
`approval_request` rows on entity creation. It was retired when
approval-request creation moved to inline edge-trigger code emitted
directly into `service.ts.jinja2`'s `add{Parent}`/`update{Parent}` (see
`docs/knowledge/appendix/approval-flow.md` §16.4) — a write-once,
hand-editable stub was the wrong shape for logic that has to uphold a
correctness invariant ("at most one open approval flow"), since a user
edit to the stub could silently break it.

The current version is unrelated to approval-request creation, which still
lives entirely in that inline edge-trigger code. It is a general-purpose
extension point, in the same family as `service_validation_custom.ts` — the
signature and in-tx semantics deliberately mirror `afterApprove` rather
than reusing anything from the first version.

## The other seven hooks

`afterCreate` is one of eight in-tx hooks that all share the same contract:
run inside the same Prisma transaction as the write they're attached to, a
throw rolls back that entire transaction, and the default (unedited) stub
is a no-op. The reason this matters: a side effect that runs outside the
write's own transaction can leave the write committed with its side effect
silently missing -- an inconsistency the caller never sees and can't
detect. Requiring every one of these hooks to run in-tx is what closes
that gap.

| Hook | File | Signature | Generated for |
|---|---|---|---|
| `afterCreate` | `service_after_create.ts` | `(tx, entityId)` | every `can_create` entity |
| `afterUpdate` | `service_after_update.ts` | `(tx, entityId)` | every `can_update` entity |
| `afterDelete` | `service_after_delete.ts` | `(tx, entityId)` | every `can_delete` entity |
| `validateOnDelete` | `service_validation_delete.ts` | `(tx, entityId, prevRow)` | every `can_delete` entity |
| `afterSubmit` | `service_after_submit.ts` | `(tx, entityId, approvableId)` | every entity with an `approvable` bridge |
| `beforeApprove` | `service_before_approve.ts` | `(tx, entityId, approvableId, actorId)` | every entity declaring `x-approval` |
| `beforeReject` | `service_before_reject.ts` | `(tx, entityId, approvableId, actorId)` | every entity declaring `x-approval` |
| `beforeWithdraw` | `service_before_withdraw.ts` | `(tx, entityId, approvableId, actorId)` | every entity declaring `x-approval.on_withdrawn` |

All eight are write-once stubs (`_write_stub()`), model-keyed rather than
view-keyed (same reasoning as `afterCreate` above), and never swept by
`cleanup.py` even for an orphaned entity.

### Post-write hooks: `afterUpdate` / `afterDelete`

Exact mirrors of `afterCreate`, called from `update{Parent}()`/
`delete{Parent}()` right before their own transaction closes, after every
other write in that transaction has completed. `delete{Parent}()` for a
non-audited entity previously issued several independent `prisma.*` calls
with no shared transaction at all; it is now wrapped in its own
`prisma.$transaction()` for exactly this reason -- without a transaction,
`afterDelete` throwing would do nothing to undo a delete that had already
committed.

### `validateOnDelete`: the delete-side counterpart to `validateCustomRules`

Create and update both run a hand-written validation hook
(`validateCustomRules`, see `docs/knowledge/pre-edit-row-handoff-to-custom-
validation.md`) before their own write. Delete had no equivalent
convergence point at all -- a schema that wanted to block a delete under
some condition had nowhere to put that check. `validateOnDelete` fills that
gap: called once per row about to be deleted, before `deleteMany()`,
receiving the full pre-delete row as `prevRow`. Throwing rejects the
delete for that id and rolls back the whole transaction (nothing has
actually been deleted yet at the point it runs).

### `afterSubmit`

Fires once whenever an entity's approval flow is opened -- on create (an
entity created already at its `x-approval.submit_on` target value, or with
no `submit_on` declared at all), on an ordinary edit that crosses the
`submit_on` edge, and from the standalone `submit_for_approval` action.
All three paths build their `approval_request` row(s) through the same
shared code path, so `afterSubmit` is called from that one place rather
than being duplicated at each of the three call sites.

### `submit_for_approval` now validates

Every write path except one already ran hand-written validation before its
own write: create and update call `validateCustomRules` from inside
`service_validation.ts`; approve/reject/withdraw now call their own
`beforeApprove`/`beforeReject`/`beforeWithdraw` (below). The standalone
`submit_for_approval` action was the one write path that reached the
database directly with no validation hook of any kind. It now calls
`validateCustomRules` with the single field it's actually writing, the same
hook create/update already use -- not a new, parallel validation socket.

### `beforeApprove` / `beforeReject` / `beforeWithdraw`

The pre-action counterpart to `afterApprove`/`afterReject`/`afterWithdraw`
(see `docs/knowledge/appendix/approval-flow.md`): called before
`approval_request.status` is written, inside the same transaction, from
both the REST route (`app/api/approval_request/[id]/{approve,reject,
withdraw}/route.ts`) and the Server Action path (`lib/approval_request/
actions_core.ts`) -- both entry points call it, since they duplicate each
other's transaction body rather than sharing one.

`beforeApprove`/`beforeReject` are generated for every entity that declares
`x-approval` at all, unconditionally -- unlike the after-hooks, which are
opt-in via `emit_hook`. Approving or rejecting a request is always possible
regardless of what an entity's `x-approval` block configures, so unlike
the after-hooks (which fire only when their own event is opt-in-declared),
there is no narrower condition to gate on -- the same reasoning that makes
`validateCustomRules` itself unconditional.

`beforeWithdraw` is narrower: generated only for entities declaring
`x-approval.on_withdrawn`, the same set `on_withdrawn_dispatch.ts` already
uses. Withdrawal itself is blocked entirely (`hasOnWithdrawn`) for any
entity that doesn't declare `on_withdrawn`, so a `beforeWithdraw` stub
without that same restriction would never be reachable -- dead code.
