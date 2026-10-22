# Permission Lookup: One Fetch Per Request, Checked Before the Record

## Principle

A single request never issues more than one `getModelPermissions()`-backed
database query for a given `(model, userId)` pair, and the permission check
for a row always runs **before** that row is fetched. Both properties hold
across REST Route Handlers and Server Actions alike.

## Why more than one call used to happen

`getModelPermissions`/`getPermissionRowsForUser`/`getUserRoleIds`
(`lib/authz.ts`) are wrapped in React's `cache()`. `cache()` only dedupes
calls inside a React render tree (a Server Component render or a Server
Action) — a Next.js Route Handler (`app/api/.../route.ts`) is not part of a
React render, so a `cache()`-wrapped function called more than once with
identical arguments inside one Route Handler invocation runs its body in
full every time. A row-level capabilities endpoint that separately checked
read, then update, then delete on the same item issued three independent,
byte-identical `permission.findMany` queries in one request as a result.

## How call sites avoid a second fetch: reuse the RichPermissions object

The fix is not a bigger cache — it is removing the reason to call
`getModelPermissions()` a second time at all. `resolvePermissions(perms,
item, userId)` (also in `lib/authz.ts`) computes **all four** operation
flags (`create`/`read`/`update`/`delete`/`import`) for an item in one call,
regardless of which single operation the caller originally asked about.
That means a call site that has already fetched a `RichPermissions` object
for an item — for any operation — already has the answer for every other
operation on that same item, and needs no further call:

```ts
// app/api/{{ parent }}/[id]/capabilities/route.ts (generated)
const basePerms = await requireApiPermission(actorId, model, 'read');
const item = await get{{Parent}}Detail(id);
if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
const resolved = await resolvePermissions(basePerms, item, actorId);
// resolved.update / resolved.delete are already correct here — no
// canAccess()/getModelPermissions() call needed for either.
```

`code_generator/templates/api_capabilities_route.ts.jinja2` (the row-level
capabilities endpoint), `api_detail_route.ts.jinja2` (GET/PUT/DELETE), and
`api_import_route.ts.jinja2` (the per-row CSV update-permission check,
previously one `canAccess()` call per imported row) all follow this
pattern: fetch a `RichPermissions` object once, then read every operation
flag off the resolved object rather than calling `canAccess()`/
`getModelPermissions()` again for the same `(model, userId)`.

Parallelizing the old, now-removed redundant calls with `Promise.all`
would not have been an adequate fix on its own: DB *load* under concurrent
traffic depends on the number of independent queries issued, not on
whether they overlap in wall-clock time. Two calls run concurrently still
cost two queries.

## Why the permission check must precede the record fetch

The item-level (Creator/Assignee) resolution needs the record's
`creator_id`/`assignee_id` — so a naive "check permission first" is in
tension with "the check needs the item." The generated routes resolve this
with a two-phase check:

1. **Coarse, item-independent gate first**: `requireApiPermission(actorId,
   model, operation)` with no `item` argument checks only the
   model-level, unresolved `RichPermissions` — true if the caller has a
   general grant, OR is a member of a role (`Creator`/`Assignee`) that
   *could* grant access to some item of this model. A caller with none of
   these has zero possible access path to any row of this model, and is
   rejected here — before the route ever queries the item table.
2. **Item-level resolution second**: once the item is fetched (and found —
   a genuine "not found" still short-circuits to 404 at this point), the
   *same* `RichPermissions` object is resolved against the item via
   `resolvePermissions()` and the specific operation flag is checked.

This ordering closes an information-disclosure gap: previously, an item
was fetched (and a 404 returned for a missing id) *before* any permission
check ran, so a caller with literally no access to the model at all could
still distinguish "this id doesn't exist" (404) from "this id exists but I
can't touch it" (403) — for every id they cared to probe. After the
reorder, a caller with zero possible access path never reaches the point
where the item table is queried, so they cannot observe that distinction
for any id. A caller who *does* hold a possible access path (a general
grant, or role membership that turns out not to match this specific item)
can still observe a 404-vs-403 split — narrowing the audience able to
observe it to callers who already have some form of access to the model,
not eliminating the split for that narrower audience. Fully collapsing
404-and-403-for-item-denial into one response is a larger, separate
design change (self-only entities and `x-filter-values` already do this,
returning 404 for both cases — see `api_detail_route.ts.jinja2`'s
`is_self_only`/`filter_values` branches) and is not this change's scope.

## Request-scope memoization: a backstop, not the primary mechanism

`lib/_request_scope.ts` provides an `AsyncLocalStorage`-based per-request
memoization layer (`memoizeInRequestScope`), entered via
`enterRequestScope()` at the top of `authenticateApiKey()` (API-key path)
and `getSessionUserId()` (session-cookie path — also the first call most
Server Action/Server Component code makes). `getModelPermissions`,
`getPermissionRowsForUser`, and `getUserRoleIds` all check this store
before touching the database, so a call site the sweep below didn't reach
still coalesces multiple calls into one query within a request. `cache()`
remains on all three functions too — harmless where it already worked
(Server Component render trees), and a no-op fallback wherever no request
scope is active.

This is deliberately a **backstop**, not the primary fix: the primary
answer to "don't call `getModelPermissions()` twice" is "don't write a
second call at the template level" (the RichPermissions-reuse pattern
above). Relying on a cache to paper over a redundant call site is strictly
weaker than removing the redundant call, since it does nothing for a
caller shape the cache doesn't recognize (e.g. two different memoization
keys for what is semantically the same permission check) and adds an
extra layer to reason about. Both mechanisms coexist because the backstop
costs nothing when the primary fix has already removed the redundancy it
would otherwise have caught.

## Known gaps not addressed by this change

Two call sites have the same fetch-before-check shape but were not
reordered, because closing them changes an error a caller can already
observe (an "Attachable not found"/"Comment not found" thrown `Error`
possibly becoming a permission error instead) in a way carrying more risk
than reward for their (Server-Action-only, non-guessable-id) exposure:

- `attachment_actions.ts.jinja2`'s `assertCanEditBridge()` fetches the
  attachment's owner row before calling `requirePermission()`.
- `actions.ts.jinja2`'s `toggle{{Parent}}CommentReaction()` fetches the
  comment and its parent row before calling `requirePermission('read',
  ...)`.

`comment_reactions_api_route.ts.jinja2` (the REST counterpart to the
Server Action above) performs no owner-entity permission check at all —
a pre-existing, already-documented gap in that template's own header
comment (its own "D7=B" note), unrelated to this change.
