# Performance Improvements — Patterns & Lessons Learned

## Context

The application uses a Vercel-hosted database in Tokyo. Typical latency per DB query is
~500ms (request round-trip) plus ~600–700ms for content download. This means every
sequential DB call stacks latency visibly for the user.

The improvements below target:
1. **Perceived performance** — show something quickly, fill in content later
2. **Parallelism** — avoid sequential DB calls where order doesn't matter
3. **Redundant renders** — avoid unnecessary cache invalidation that triggers extra DB calls

---

## 1. Streaming Suspense (faster TTFB)

### Problem
Next.js App Router pages that `await` data in the page component block the entire
HTML response until all DB queries complete. The user sees a blank page or loading
spinner for the full DB latency.

### Pattern
Split every page into a sync outer shell + async inner content component.
The outer component returns instantly (fast TTFB) while the inner one streams in.

```tsx
// page.tsx — outer (sync, returns immediately)
export default function EntityListPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <EntityListContent />
    </Suspense>
  );
}

// inner (async, waits for DB)
async function EntityListContent() {
  const { items, userPermissions } = await getEntityList();
  return <DataGridClient rows={items} permissions={userPermissions} />;
}
```

For pages with dynamic params (edit/view), `params` must be awaited in the outer
component before passing to the inner one:

```tsx
export default async function EntityEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<FormSkeleton />}>
      <EntityEditContent id={id} />
    </Suspense>
  );
}
```

### Generated files
`app/[locale]/{entity}/page.tsx`, `page_new.tsx`, `page_edit.tsx`, `page_view.tsx`
all use this pattern. The templates are `page_list.tsx.jinja2`, etc.

---

## 2. Skeleton Screens

### Problem
Even with Suspense streaming, the user sees nothing interactive while data loads.
A blank fallback is worse than a visual placeholder.

### Pattern
Use MUI `<Skeleton>` components shaped like the actual content.

**TableSkeleton** (for list pages):
```tsx
function TableSkeleton() {
  return (
    <Box sx={{ p: 2 }}>
      <Skeleton variant="rectangular" height={52} sx={{ mb: 1 }} />
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} variant="rectangular" height={48} sx={{ mb: 0.5 }} />
      ))}
    </Box>
  );
}
```

**FormSkeleton** (for new/edit/view pages):
```tsx
function FormSkeleton() {
  return (
    <Box sx={{ p: 2, maxWidth: 800 }}>
      <Skeleton variant="rectangular" width={200} height={36} sx={{ mb: 3 }} />
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} variant="rectangular" height={56} sx={{ mb: 2 }} />
      ))}
    </Box>
  );
}
```

These are defined inline in the page templates (not separate components) to keep
generated files self-contained.

---

## 3. Parallel Data + Permissions Fetching

### Problem
The original pattern was sequential:

```ts
// Sequential: 3 round-trips
const userId = await getSessionUserId();
const item = await getDetail(id);
const permissions = await getModelPermissions('entity', userId);
// then resolvePermissions(permissions, item, userId) to apply creator/assignee context
```

`getSessionUserId()` had to finish before anything else could start.

### Solution
`getModelPermissions()` now returns `{ permissions, userId }` together, so a single
call replaces the separate `getSessionUserId()` call. This enables full parallelism:

```ts
// Parallel: 1 round-trip for both
const [item, { permissions: basePermissions, userId }] = await Promise.all([
  getDetail(id),
  getModelPermissions(),
]);
const resolved = await resolvePermissions(basePermissions, item, userId);
```

For list pages, permissions and data are also fetched in parallel:

```ts
const [{ permissions: userPermissions, userId }, items] = await Promise.all([
  getModelPermissions(),
  getAllEntities(),
]);
```

### Type design
`getModelPermissions` returns `RichPermissions` (includes `general/creator/assignee`
sub-objects for item-level resolution). Components receive `ModelPermissions`
(= `OperationFlags`) after stripping via `toPermissions()`.
This keeps the public API of components simple.

```ts
export type ModelPermissions = OperationFlags;  // { create, read, update, delete, import }
```

(`OperationFlags` was 4 booleans when this section was first written;
`import` was added as a fifth `Operation` value later — see `lib/authz.ts:23`.
The type-design point this section makes is unaffected by the flag count.)

```ts
export interface RichPermissions extends OperationFlags {
  general: OperationFlags;
  creator: OperationFlags | null;   // null if no creator role defined
  assignee: OperationFlags | null;  // null if no assignee role defined
}
```

### Creator/Assignee list filtering
This used to be an application-level `items.filter(...)` step run after an
unscoped fetch (as this section originally described), but that was replaced
by a DB-level filter (`getters.ts.jinja2`'s `build{Parent}AccessWhere()`,
introduced 2026-05-04, well after this doc's original write-up) once the
`AccessWhere`-based query rewrite landed. When a user only has creator or
assignee read (not general read), the where clause pushed into the `findMany`
call itself already scopes the rows returned — there is no unscoped fetch to
filter after the fact:

```ts
if (!perms.general.read) {
  const or: Record<string, unknown>[] = [];
  if (perms.creator?.read && userId) or.push({ creator_id: userId });
  if (perms.assignee?.read && userId) or.push({ assignee_id: userId }); // has_assignee_id entities only
  and.push(or.length === 0 ? { id: '__no_access__' } : { OR: or });
}
```

---

## 4. Eliminating Redundant DB Queries

### Problem: double `getAllEntities` after form submit

After `upsertEntity` + `redirect('/entity')`, the list page was fetching from the DB
twice. The root cause was using both `revalidatePath` and `redirect` in the same action:

```ts
// Before — caused double fetch
revalidatePath('/entity');  // triggers background re-render of /entity
redirect('/entity');         // navigates to /entity, also re-renders it
```

Two renders fired simultaneously: one from `revalidatePath` and one from the navigation
caused by `redirect`.

### Fix
Remove `revalidatePath` from the upsert action. `redirect()` in a Server Action
already forces a fresh fetch of the destination route when that route differs
from the one the action runs on — `upsertEntity` runs on the create/edit form
(`/entity/new` or `/entity/edit/[id]`) and redirects to the list page
(`/entity`), a different route, so `revalidatePath` is redundant there:

```ts
// After — single fetch
// (no revalidatePath import needed)
redirect('/entity');
```

**The delete action keeps `revalidatePath`** — this is not a leftover, it's
still required. `removeEntity` is wired up directly on the list page itself
(`page_list.tsx.jinja2` passes `removeAction={removeEntity}` straight to the
DataGrid), so the user is already on `/entity` when delete runs and
`redirect('/entity')` is a same-route redirect. Next.js's router doesn't
necessarily refetch a route the user is already on, so without
`revalidatePath` the list can keep showing the just-deleted row. `upsertEntity`
doesn't have this problem because it always redirects from a *different* route
(the form) to the list — a genuine cross-route navigation, which Next.js does
refetch on its own:

```ts
// remove{Parent} — revalidatePath still needed: redirect target === current route
if (can_list) {
  revalidatePath('/[locale]/entity', 'page');
}
redirect('/entity');
```

(History: `revalidatePath` was removed from both upsert and delete in one
commit for perceived double-fetch reasons, then revived specifically for
delete about a week later — commit `b180b99`, "fix: Revive revalidatePath for
delete" — once the stale-list-after-delete symptom surfaced. The commit
message doesn't spell out the same-route-redirect mechanism, but it matches
the code exactly: the revived call is scoped to `remove{Parent}` only, gated
on `can_list`.)

### Problem: `router.refresh()` in `handleBack`

The form's back button called `router.push()` followed by `router.refresh()`.
The push navigates away, then the refresh triggers an additional render of the previous
page — causing `getDetail` and potentially `getAllEntities` to fire again.

### Fix
Remove `router.refresh()` from `handleBack`. No refresh is needed when navigating
away from a form — the list page will fetch fresh data on its own when the Suspense
boundary resolves.

```ts
// Before
const handleBack = () => {
  router.push('/entity');
  router.refresh();  // caused extra getDetail + getAllEntities calls
};

// After
const handleBack = () => {
  router.push('/entity');
};
```

### Exception: comment actions
Comment child actions (add/update/delete comment) do NOT redirect — they update
the current page in place. These still need `revalidatePath` to invalidate the
server-side cache so `router.refresh()` in the client gets fresh data:

```ts
// Comment actions — keep revalidatePath, no redirect
import { revalidatePath } from 'next/cache';

export async function addEntityComment(...) {
  await db.comment.create(...);
  revalidatePath('/entity');  // needed: no redirect, client calls router.refresh()
}
```

### `revalidatePath`'s path argument must match a real route file

`revalidatePath` never throws for a path that matches nothing — it just does nothing for
that page. A literal path with no dynamic segment (`revalidatePath('/entity')`) only
targets that exact route file; a path containing a dynamic segment (e.g. `/entity/[id]`)
requires the second `type` argument (`'page'` or `'layout'`) or Next.js rejects it. Locale
routes live under `app/[locale]/...`, so any path under a localized segment needs the
literal `[locale]` segment in the pattern too:

```ts
// Wrong — matches nothing: no [locale] segment, no type for the dynamic id segment.
revalidatePath('/entity');

// Right — matches app/[locale]/entity/view/[id]/page.tsx.
revalidatePath('/[locale]/entity/view/[id]', 'page');
```

This matters most for actions that invalidate a page *other than the one they're
conceptually attached to* — an approval action attached to `approval_request` but
invalidating the target entity's own view/edit pages (`lib/approval_request/
actions_core.ts`), or an attachment action invalidating its owner entity's pages
(`code_generator/templates/attachment_actions.ts.jinja2`). Both need view *and* edit
invalidated, since `x-custom-components` can mount a component (`ApprovalSection`,
an attachment list) on either page (`target: [view, edit]` — see
`code-generation-custom-extensions.md` §2):

```ts
revalidatePath(`/[locale]/${entityName}/view/${targetId}`, 'page');
revalidatePath(`/[locale]/${entityName}/edit/${targetId}`, 'page');
```

**Next.js 16 caveat (may make this hard to notice in manual testing):** per the
[`revalidatePath` docs](https://nextjs.org/docs/app/api-reference/functions/revalidatePath),
"Server Functions: Updates the UI immediately (if viewing the affected path). **Currently,
it also causes all previously visited pages to refresh when navigated to again. This
behavior is temporary and will be updated in the future to apply only to the specific
path.**" On the Next.js version installed when this note was written (`^16.1.1`; `16.3.4` is
currently installed per `package-lock.json` — whether the upstream caveat above still holds
verbatim on `16.3.4` was not re-verified for this pass, since it would require re-testing
`revalidatePath`'s runtime behavior, not a code-crosscheck), calling `revalidatePath` with
*any* argument — even
one that matches nothing — still refreshes previously-visited pages on next visit, so a
wrong path argument does not currently reproduce as a visible stale-page bug. It will once
Next.js ships the narrower, path-matching-only behavior the docs describe as planned —
getting the path right now is what keeps this code correct once that ships, not just a
cosmetic cleanup.

---

## 5. List Pagination: `findMany` + `count` Run Independently (Not `$transaction`)

### Problem

`get{Parent}Page()` (`getters.ts.jinja2`) originally bundled its `findMany` and `count`
calls into a single batch transaction:

```ts
const [rowsRaw, total] = await prisma.$transaction([
  prisma.{{ model }}.findMany({ where, orderBy, skip, take, ... }),
  prisma.{{ model }}.count({ where }),
]);
```

A `prisma.$transaction([...])` (the batch/array form) needs to acquire connections for
*every* member query up front, atomically, before either query can start — and Prisma's
default `maxWait` for this acquisition step is 2000ms (confirmed via
`@prisma/client/runtime/client.d.ts`'s `PrismaClientBaseOptions.transactionOptions` doc
comment: `"maxWait ?= 2000"`; distinct from the batch form's `timeout`, default 5000ms,
which bounds the queries' own execution once started — the two are separate
`BatchTransactionOptions` fields, easy to conflate).

Under concurrent load (`PRISMA_POOL_MAX=5`, with the cross-entity search endpoint's own
parallel queries — see `search.md`'s Issue #725/#727/P2028-hotfix history — also competing
for pooled connections), the batch transaction could not always acquire both member
queries' connections within 2000ms. This produced `P2028` ("Unable to start a transaction
in the given time") on every list endpoint using this pattern, reproduced at real data
scale (N=30,000) with `PRISMA_POOL_MAX=5` under concurrent search load: `GET /api/policy`
21.55% error rate, `GET /api/service_request` 22.10%, `DELETE /api/provider/:id` 20.59% —
while list/detail endpoints without this transaction wrapper stayed at 0% error under the
identical load, isolating the transaction wrapper (not general pool pressure) as the cause.

### Fix

Run `findMany` and `count` as two independent queries via `Promise.all` instead:

```ts
const [rowsRaw, total] = await Promise.all([
  prisma.{{ model }}.findMany({ where, orderBy, skip, take, ... }),
  prisma.{{ model }}.count({ where }),
]);
```

Each query now independently acquires whichever pooled connection frees up first, instead
of both needing to be grabbed atomically before either can start — eliminating the
`maxWait` bottleneck entirely. This mirrors the fix already applied to `buildSearchQuery()`
(`search_helpers.ts.jinja2`) for the analogous P2028-under-`$transaction` failure mode.

This section eliminates P2028 on the read side by removing an unnecessary transaction.
`addEntity`/`updateEntity`'s write-side `$transaction` cannot be removed the same way (a
multi-model write genuinely needs atomicity) — see
`docs/knowledge/p2028-capacity-misclassification-fix.md` for how P2028 is instead handled
correctly there when it does occur under contention.

### Trade-off: no longer atomic

`findMany` and `count` can now see different snapshots if a write lands between them (e.g.
a row inserted or deleted mid-page-load could make `total` off by one relative to
`rowsRaw`). This is accepted, not overlooked: every list/detail read path that never wrapped
its query in a transaction at all already makes this same trade (a plain `findMany` reads a
snapshot that can be stale by the time it reaches the client), and real-scale load testing
found those non-transactional endpoints error-free while this transactional pair alone
produced `P2028`. If a future requirement needs `findMany`/`count` to be read from a single
consistent snapshot, that requirement must come with an explicit review of both `maxWait`
and `timeout` against measured query time under real load — re-adding `$transaction`
without that review reintroduces this exact regression.

### Regression coverage

`code_generator/tests/test_list_pagination_no_transaction_wrapper.py` renders the fixture
schema through the real `build_user_schema.py` → `generate.py` pipeline and asserts no
generated `getters.ts` wraps `findMany`+`count` in `prisma.$transaction([...])` — confirmed
to fail against the pre-fix template (2 assertions, both catch the regression independently).

---

## 6. Batching Permission Queries Across Models (`getModelPermissions`)

### Problem

`getModelPermissions(model, userId)` (`lib/authz.ts`) is called once per model — every
generated entity's own `requirePermission`/`canAccess` calls, plus the cross-entity search
path (`search_helpers.ts.jinja2`, one call per entity in `ALL_ENTITIES`). Its underlying
query filtered by `name: model`:

```ts
const rows = await prisma.permission.findMany({
  where: { name: model, OR: [ /* 3-branch role/global OR */ ] },
  select: { create: true, read: true, update: true, delete: true, import: true, role: { select: { name: true } } },
});
```

The per-request React `cache()` wrapper on `getModelPermissions` only dedups repeat calls
for the *same* `(model, userId)` pair. A cross-entity search touching N entities in one
request still issued N separate `permission.findMany` queries — one per model, all for the
same user, all satisfying the identical role-membership OR clause — because each call's
cache key includes `model`.

### Fix

Dropped the `name: model` filter from the query and added `select: { name: true, ... }` so
the result carries which model each row belongs to. The fetch itself moved into a new
function, `getPermissionRowsForUser(userId)` — cached by `userId` alone (both the
per-request React `cache()` layer and the per-process TTL LRU layer) — so every model a
request asks about converges on the same cached row set instead of triggering its own
query:

```ts
const getPermissionRowsForUser = cache(async (userId: string) => {
  // ... same 3-branch OR, no name filter, select adds `name: true` ...
});

// inside getModelPermissions(model, userId):
const allRows = await getPermissionRowsForUser(resolvedUserId);
const rows = allRows.filter((row) => row.name === model);
```

`getModelPermissions` itself is unchanged apart from this substitution — the audit_log
special case, the `SELF_ONLY_ADMIN_BYPASS_ENTITIES` no-rows fallback, and the
Creator/Assignee aggregation loop all still operate on `rows` (now the per-model slice of
the batched result) exactly as before. A 25-entity cross-entity search collapses from 25
`permission.findMany` calls to 1 per (request, user); a single-model call (an ordinary list
or detail page) is unaffected in query count, only in query shape (no `name` filter).

### Why this doesn't change what any model's permissions resolve to

The 3-branch OR clause (global `role_id: null` rows, the user's non-special roles, and the
always-fetched Creator/Assignee role definitions) is unchanged — removing the `name`
filter only widens which models' rows come back in one call, not which rows match the OR
for a given model. `role`/`permission` records carry no `organization_id` (RBAC is
tenant-global), so batching across models does not cross any org-isolation boundary.
`lib/authz.test.ts`'s "batched multi-model query" test group pins this: given one batched
result spanning multiple models, filtering to any single model reproduces exactly the same
permissions a model-only query would have returned, with no cross-model leakage.

### Regression coverage

`lib/authz.test.ts` — the "batched multi-model query: per-model grouping is equivalent to
a per-model query" describe block asserts, against a single mocked result set spanning
three different models: (1) the requested model's permissions are correct even when other
models are present in the same batch, (2) a model with no rows in the batch is still
denied (no accidental grant from another model's rows), (3) a global `role_id: null` row
resolves correctly when mixed with other models, and (4) exactly one `findMany` call is
issued per `getModelPermissions` invocation, with no `name` key in the query's `where`.

---

## Summary Table

| Technique | Where applied | Effect |
|---|---|---|
| Streaming Suspense | All generated pages | Fast TTFB; skeleton shows while DB loads |
| Skeleton screens | All generated pages | Visual placeholder instead of blank/spinner |
| Parallel permissions + data | `getters.ts` (list + detail) | Saves one sequential DB round-trip |
| `getModelPermissions` returns `userId` | `lib/authz.ts` | Eliminates separate `getSessionUserId` call |
| Batch permission rows across models per (request, user) | `lib/authz.ts` (`getPermissionRowsForUser`) | 25-entity search: 25 `permission.findMany` calls → 1 |
| Remove `revalidatePath` from upsert (kept on delete — same-route redirect) | `actions.ts` | Eliminates double `getAllEntities` on save |
| Remove `router.refresh()` from `handleBack` | `FormUpsert.tsx` | Eliminates extra `getDetail` on back navigation |
| `findMany`+`count` via `Promise.all` (not `$transaction`) | `getters.ts` (list pagination) | Avoids batch-transaction `maxWait` P2028 under concurrent load |
