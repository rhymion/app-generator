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
