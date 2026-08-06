# cmd_564: generic invalidate mechanism — `location` consumer patch

> Ready-to-apply reference for wiring the generic `invalidated_at` mechanism (cmd_564) onto a
> consumer's `location` entity, once that consumer's `app-generator` submodule pointer is bumped
> past cmd_564. This repo's own `json_schema.yaml` has no `location` entity at all (it's a
> proj_c/proj_g-only concept, per cmd_562's own report) — the mechanism itself is proven generic
> here via a self-contained fixture pair (`code_generator/tests/test_invalidate_mechanism_fixture.py`),
> and this doc carries the one remaining piece (the actual `location` wiring) forward to whichever
> consumer applies it, the same way `cmd562-location-id-fk-consumer-migration.md` did for the
> id-FK column itself. Re-verify current column/model names against the target repo's own
> `prj/prisma/schema.prisma` / `prj/code_generator/json_schema.yaml` before applying — both were
> out of scope for this task (proj_c/proj_g work trees must not be touched from here).

## 0. Prerequisite

The consumer's `app-generator` submodule pointer must include this cmd's three generic-mechanism
commits (`build_context.py`/`getters.ts.jinja2` WHERE-clause change, `anonymize_user.ts.jinja2`
`invalidated_at` co-set, `DataGridClient.tsx` icon unification to `BlockIcon`). No config keys are
required to reach it — the mechanism activates purely from `x-generate.invalidate.enabled: true`
on any entity, same convention already in place for `user`/`anonymizeUser`.

## 1. Schema changes

### 1.1 `code_generator/json_schema.yaml` — `location` entity

Add only the `invalidate` config to `definitions.location`'s existing entity-level `x-generate`
block. Do **not** add a `properties.invalidated_at` declaration (see the note below):

```diff
   location:
     x-generate:
       ...
+      invalidate:
+        enabled: true
+        module: lib/location/invalidate_location
+        # NOT invalidateLocation (see note below) — must differ from the
+        # generated invalidate{Entity} wrapper name.
+        handler: doInvalidateLocation
     fields:
       name: {}
```

**Root cause / do not use `invalidate{Entity}` as the handler name.** The generated
`actions.ts.jinja2` wrapper always exports a function named `invalidate{Entity}`
(here, `invalidateLocation`) and statically imports the configured `module`/`handler`
under that same import. If `handler` is also literally `invalidateLocation`, the two
same-named declarations collide — `next build` fails with "the name 'invalidateLocation'
is defined multiple times." No existing test catches this (it's a static-import
collision, not a runtime behavior difference), so it surfaces only as a build break.
Pick any handler name distinct from `invalidate{Entity}` (this doc uses
`doInvalidateLocation`, the name actually applied in proj_c's consumer patch).

No `filter_field` key is needed — the mechanism is convention-based: `enabled: true` alone makes
`searchLocationOptions()`'s WHERE clause exclude `invalidated_at IS NOT NULL` rows automatically.
It reads the column-name convention off the entity-level `x-generate.invalidate` block only; it
never reads a `json_schema.yaml` property named `invalidated_at`. A field/property that never
displays on screen needs no schema declaration at all as long as it's defined in
`prisma/schema.prisma` (§1.2) — declaring it anyway caused two problems fixed in cmd_570: it
collided with the entity-level `x-generate` key already used for a different purpose (same key
name, different meaning, on the same entity), and its `x-generate.hidden_from_form: true` sub-key
was never read by any generator code (dead config). **Do not reintroduce a `properties.invalidated_at`
block, and do not reuse the `x-generate` key name for property-level generation control if that is
ever added in the future — pick a different key name.**

### 1.2 `prisma/schema.prisma` — `location` model

```diff
   model location {
     id             String    @id @default(cuid())
     name           String
+    invalidated_at DateTime?
     ...
   }
```

### 1.3 New hand-written handler: `lib/location/invalidate_location.ts`

```typescript
'use server';

import prisma from '@/lib/prisma';

export async function doInvalidateLocation(id: string): Promise<void> {
  await prisma.location.update({ where: { id }, data: { invalidated_at: new Date() } });
}
```

This is a hand-written file (like `lib/compliance/anonymize_user.ts`'s handler pattern), not
generated — the generator only imports and calls it via the `module`/`handler` config above.
The function name here must match whatever `handler` is set to in §1.1's config (see that
section's note on why it cannot be `invalidateLocation`).

## 2. Migration SQL

No backfill needed — `invalidated_at` is a brand-new concept for `location` (unlike `user`'s
`anonymized_at`→`invalidated_at` co-set, there is no pre-existing "already invalidated" state to
carry forward). A plain nullable column addition suffices:

```sql
ALTER TABLE "location" ADD COLUMN "invalidated_at" TIMESTAMP;
```

Applied via `npx prisma migrate dev --name location_invalidated_at` (or hand-authored under
`prj/prisma/migrations/`) once §1.2's schema.prisma edit is in place.

## 3. Verification (do not skip — "added a column" is not proof the mechanism fires)

1. Regenerate (`generate-code`) and confirm `lib/location/getters.ts`'s `searchLocationOptions()`
   WHERE clause now includes `{ invalidated_at: null }` (same shape verified generically by
   `code_generator/tests/test_invalidate_mechanism_fixture.py`'s `widget` fixture entity in this
   repo).
2. Invalidate a real `location` row (via the generated `invalidateLocation` server action /
   DataGrid button) and confirm it no longer appears in `searchLocationOptions()`'s autocomplete
   results for a *new* FK selection.
3. Confirm an existing ledger row that already referenced the now-invalidated location still
   displays that location's label correctly on its own detail/edit page — this is driven by the
   ledger row's own `getXxxDetailPageData()` relation include (`src.location`), a separate code
   path from `searchLocationOptions()`, so it is unaffected by the WHERE-clause change; verify this
   is still true empirically rather than assuming it from the code path being "different."
4. Confirm the DataGrid's invalidate button now renders `BlockIcon` (not `PersonOffIcon`) in both
   the list view and the edit form (`FormWithChildGrid.tsx` already used `BlockIcon`, so only the
   list view changes visibly).

## 4. Scope deliberately excluded from this patch (separate future work)

Per this cmd's own ruling, the following stay out of both this repo and this patch:

- Behavior (1): invalidated rows become read-only on their edit page.
- Behavior (2): invalidated rows are excluded from the list page by default, with a toggle to
  reveal them.
- API-layer FK validation on create/update (defense in depth beyond the autocomplete exclusion).
- Splitting `invalidate` into its own permission (currently reuses `delete`'s permission, same as
  `user`/`anonymizeUser`) — the existing `DataGridClient`/`FormWithChildGrid` TODO comment about
  this is a known, accepted debt, not something this patch resolves.
