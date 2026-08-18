# CSV-import commit-time CREATE skipped the auto-create bridge FK pre-create

## Symptom

An entity with a required internal bridge FK (e.g. `approvable_id` on an
`x-approval` entity) had `import_can_create` correctly computed as `true`
(an earlier fix corrected the `_create_feasible` gate that used to gate this off), and
a CSV-import dry run for a mismatched row (no existing row matches the
natural key) reported `succeeded: 1`, no errors, and issued a
`confirmToken`. Confirming that same dry run — the actual commit
(`dryRun: false`) — failed with a Prisma `PrismaClientValidationError`
naming the bridge FK column (e.g. `approvable_id`) as missing. Concrete
trigger: `goods_receipt_line` (an `x-approval` entity), importing a row
whose `(goods_receipt.receipt_number, item.sku)` natural key didn't match
any existing row.

Because dry run never touches the database, this bug was invisible until
someone actually confirmed a "successful" dry run — a two-step trap: the
step that looks safe (dry run) always succeeds, and the step that commits
real data is the one that fails.

## Root cause

`api_import_route.ts.jinja2`'s per-row loop (dry-run phase) builds
`action.data` from the CSV row plus resolved FK columns
(`{ ...data, ...keyWhere, ...fkData, creator_id, updater_id }`) and queues
it as a pending action — this part is correct and includes every FK the
*client* can supply. The commit-time transaction then did:

```ts
await tx.{{ model }}.create({ data: action.data as any });
```

— a bare create from that same object, with nothing else. This works fine
for an entity with no auto-create one-to-one relations. But an entity with
an `x-approval` (or any other internal one-to-one bridge — `x-relationship`
of `type: one-to-one_bridge`) needs its bridge row created and wired at
CREATE time; `action.data` was computed at dry-run time and structurally
never contains that FK, since the CSV row can never supply it (it's
server-managed plumbing, not client data — the same reasoning `_create_feasible`
already codified for feasibility).

`service.ts.jinja2`'s `add<Entity>()` function — the *normal* create path —
already solves exactly this: `build_context.py` computes
`one_to_one_pre_creates` (`const approvable = await tx.approvable.create({
data: {} });` for each auto-create OTO relation) and
`one_to_one_fk_data_lines` (`approvable_id: approvable.id,`), and
`service.ts.jinja2` emits the pre-create statement inside the transaction
before the model's own `create()`, then merges the FK line into that
`create()`'s `data`. The import route's commit-time branch never consumed
either of these — it was built independently and never wired to the same
mechanism.

A second, narrower gap: `one_to_one_fk_data_lines` itself was never exposed
in `build_context.py`'s returned context dict — it was computed and used
only to build `parent_data_obj` (via string concatenation), then discarded
as a standalone name. Any template other than `service.ts.jinja2` wanting
the FK-merge lines on their own (as the import route's fix needs, since its
`data` object is built from `action.data`, not `parent_data_obj`) couldn't
reach it — referencing an undeclared context var renders silently as an
empty string under Jinja2's default `Undefined`, no error, just a quietly
incorrect result. This class of failure — a fix that *looks* complete
because the template change is syntactically fine but the referenced
context var was never wired through `build_context.py` — is worth checking
for explicitly whenever a fix reuses an existing context var in a new
template: grep the var's name in the final `return dict(...)` of
`build_context.py`, not just its point of computation.

## Fix

`api_import_route.ts.jinja2`'s commit-time create branch now mirrors
`service.ts.jinja2`'s pattern exactly, using the same context vars:

```ts
if (action.op === 'create') {
{% if one_to_one_pre_creates %}
{{ one_to_one_pre_creates }}
  await tx.{{ model }}.create({
    data: {
      ...(action.data as any),
{{ one_to_one_fk_data_lines }}
    },
  });
{% else %}
  await tx.{{ model }}.create({ data: action.data as any });
{% endif %}
} else {
  ...
```

`build_context.py` now also returns `one_to_one_fk_data_lines` standalone
(previously inlined only into `parent_data_obj`), so any template can
consume it directly rather than only through `service.ts.jinja2`'s specific
data-object assembly.

Entities with no auto-create OTO relation (the common case) render the
`{% else %}` branch — byte-for-byte identical to the pre-fix output.

## Verification

- **Codegen-level**: regenerated `goods_receipt_line`'s import route (has
  `x-approval`) shows the pre-create + FK-merge form; regenerated `item`'s
  import route (no bridge FK) is unchanged from the pre-fix baseline.
- **pytest** (`test_import_template_branches.py`,
  `test_auto_create_oto.py`): new assertions for both branches, plus a
  standalone assertion that `one_to_one_fk_data_lines` is present in
  `build_context()`'s returned dict. Both new template-branch assertions
  fail against the pre-fix template (deviation injection: temporarily
  restored the pre-fix template via `git show HEAD^:...`, confirmed the
  failure, restored the fix). Full `code_generator` pytest suite: 1134
  passed, 0 skipped (0 skipped only after running `generate-code` once in
  this repo's own worktree — `test_sql_safety.py` skips until `lib/**/service.ts`
  exists on disk).
- **DB-level runtime replay** (isolated worktree + isolated docker compose
  stack, real Postgres, a verification script written for this fix — not committed):
  direction (a) a non-bridge entity (`item`) create with the unchanged plain
  form succeeds; direction (b) the exact fixed `goods_receipt_line`
  transaction (pre-create `approvable` + merge `approvable_id`) succeeds
  and the created row's `approvable_id` matches the pre-created row's `id`;
  negative control — the same `goods_receipt_line` data *without*
  `approvable_id` reproduces the original `PrismaClientValidationError`
  naming the missing FK.

## Adjacent, out-of-scope observation

While tracing `goods_receipt_line`'s generated import route to build the
runtime replay, its required `unit_of_measure_id` FK turned out to already
be correctly resolved via the non-key-FK mechanism
(`fkData.unit_of_measure_id`, resolved from a `unit_of_measure_name` CSV
column) — initially looked like a second, unrelated gap, but is not one.
No follow-up needed there.
