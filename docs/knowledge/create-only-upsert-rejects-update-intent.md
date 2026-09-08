# Create-only entities: `upsert{Parent}()` now rejects an update intent instead of silently creating

## The failure this closes

An entity with `x-generate.edit: false` (create only, no update path) is
generated with `app/[locale]/{parent}/edit/[id]/page.tsx` absent, but its
`Server Action` is still named `upsert{Parent}()` and, before this fix,
never read `id` off the incoming `FormData` at all -- the create-only
branch of `actions_context`'s upsert body (`generators.py`
`_upsert_body`, `else: # create only`) unconditionally called
`add{Parent}(actorId, ...)`.

`FormUpsert.tsx` (`form_upsert.tsx.jinja2`) is a single generic component
shared by both the new-entity and edit-entity flows, and it unconditionally
does `formData.set('id', src.id)` regardless of `can_update` -- `src.id`
is `''` for a genuine new-entity form (`page_new.tsx`), but a real record
id for anything that renders `FormUpsert` with an existing record.

The combination is the trap: if an **orphaned** edit page survives on disk
(left over from before this entity's `x-generate.edit` flipped to
`false`, and no longer regenerated or cleaned up), it still renders the
freshly-regenerated `FormUpsert.tsx` with the existing record's id. The
freshly-regenerated action silently ignored that id and created a
duplicate row instead of failing -- three independently-correct-looking
layers (an orphaned page, a generic form component, and a create-only
action) compounded into a silent data-integrity bug that a green gate run
cannot detect, because no fixture or golden-diff check exercises "what an
orphan page does," only "what the generator currently emits."

Real-world incident: a `purchase_order`-shaped consumer schema entity
(`x-generate.edit: false`) had exactly this orphaned edit page.
Inspection found a duplicate row created while the original row it should
have updated was left untouched (`updated_at == created_at`).

## The fix

The create-only branch of `_upsert_body` now reads `id` first and throws
before doing any other work if it is present:

```ts
const id = data.get('id') as string | null;
if (id) throw new Error('Update not supported');
```

This exactly mirrors the existing symmetric guard already present in the
update-only branch (`can_update` true, `can_create` false):

```ts
if (!id) throw new Error('Create not supported');
```

Both are genuine "this shouldn't happen" cases -- a logic/wiring error,
not a user-facing validation failure -- so both use a plain `Error` that
crashes to `error.tsx` rather than an `AppError` translated into a
graceful `ActionFailure`. This keeps the two branches consistent instead
of one crashing loudly and the other failing softly for structurally the
same mistake.

`src.id` is `''` on the genuine new-entity path, so `if (id)` is falsy
there and the normal create flow is completely unaffected.

## Scope and verification

- This only touches the `else: # create only` branch of `_upsert_body`
  (`can_create=True, can_update=False`). No entity in this repo's own
  `code_generator/json_schema.yaml` uses that combination (all entities
  here are `edit: true`), so the fix's real-world effect on *this* repo's
  own generated output is exactly zero -- confirmed empirically, not just
  reasoned about: a full `lib/`, `app/` (excluding the Prisma client
  output), `components/`, `cypress/`, `messages/`,
  `scripts/generated/`, and `prisma/schema.prisma` diff between a clean
  `generate-code` run before and after this change is byte-for-byte
  identical.
- Because no entity in this repo's own schema exercises the create-only
  branch, its new behavior is proven at the generator level instead:
  `code_generator/tests/test_create_only_upsert_rejects_id.py` renders
  `actions.ts.jinja2` directly (same technique as
  `test_org_optional_update_existence_check.py`) against a synthetic
  `edit: false` fixture and asserts the guard renders, precedes the
  permission check, and does not leak into an `edit: true` entity's body.
  This follows the same "this repo's own dogfood schema has no example
  entity for the branch under test" pattern already used for several
  other dark-branch fixture gates documented in
  `.claude/commands/update-generator.md`, but does not add a new
  mandatory `npm run test:*-gate` fixture step, since a direct
  Jinja2-render unit test in `test:pytest` (already mandatory, already
  runs in seconds) covers the same branch without growing the Completion
  gate's step count.
- The generator's own cleanup mechanism (`npm run cleanup`,
  `--prune-orphans`) not automatically sweeping this class of
  schema-driven orphan (an entity that still exists in the schema, but
  whose `x-generate.edit` flipped from `true` to `false`) is a known,
  separate limitation and is out of scope here -- this fix makes the
  orphan's failure mode loud instead of silent; it does not remove the
  orphan itself.
