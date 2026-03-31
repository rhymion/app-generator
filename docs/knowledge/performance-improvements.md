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
(= `OperationFlags` — just 4 booleans) after stripping via `toPermissions()`.
This keeps the public API of components simple.

```ts
export type ModelPermissions = OperationFlags;  // { read, create, update, delete }

export interface RichPermissions extends OperationFlags {
  general: OperationFlags;
  creator: OperationFlags | null;   // null if no creator role defined
  assignee: OperationFlags | null;  // null if no assignee role defined
}
```

### Creator/Assignee list filtering
When a user only has creator or assignee read (not general read), the list is
filtered after fetching rather than via a DB-level filter. This keeps DB queries
simple at the cost of filtering in application code:

```ts
const filtered = userPermissions.general.read
  ? items
  : items.filter(item =>
      (userPermissions.creator?.read && item.creator_id === userId) ||
      (userPermissions.assignee?.read && (item as any).assignee_id === userId)
    );
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
Remove `revalidatePath` from upsert and delete actions entirely. `redirect()` in a
Server Action already invalidates the router cache for the destination path, so
`revalidatePath` is redundant:

```ts
// After — single fetch
// (no revalidatePath import needed)
redirect('/entity');
```

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

---

## Summary Table

| Technique | Where applied | Effect |
|---|---|---|
| Streaming Suspense | All generated pages | Fast TTFB; skeleton shows while DB loads |
| Skeleton screens | All generated pages | Visual placeholder instead of blank/spinner |
| Parallel permissions + data | `getters.ts` (list + detail) | Saves one sequential DB round-trip |
| `getModelPermissions` returns `userId` | `lib/authz.ts` | Eliminates separate `getSessionUserId` call |
| Remove `revalidatePath` from upsert/delete | `actions.ts` | Eliminates double `getAllEntities` on save |
| Remove `router.refresh()` from `handleBack` | `FormUpsert.tsx` | Eliminates extra `getDetail` on back navigation |
