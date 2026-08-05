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

Add the field declaration and the `invalidate` config to `definitions.location`:

```diff
   location:
     x-generate:
       ...
+      invalidate:
+        enabled: true
+        module: lib/location/invalidate_location
+        handler: invalidateLocation
     fields:
       name: {}
+    properties:
+      invalidated_at:
+        type: string
+        format: date-time
+        readOnly: true
+        x-generate:
+          hidden_from_form: true
```

No `filter_field` key is needed — the mechanism is convention-based: `enabled: true` alone makes
`searchLocationOptions()`'s WHERE clause exclude `invalidated_at IS NOT NULL` rows automatically.

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

export async function invalidateLocation(id: string): Promise<void> {
  await prisma.location.update({ where: { id }, data: { invalidated_at: new Date() } });
}
```

This is a hand-written file (like `lib/compliance/anonymize_user.ts`'s handler pattern), not
generated — the generator only imports and calls it via the `module`/`handler` config above.

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
