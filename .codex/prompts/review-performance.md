This is a **performance review** task. Read the relevant source files carefully before evaluating.

## How to run this review

1. Read the relevant source files.
2. Check each item in the checklist below.
3. For each item: state the current implementation, gaps, and recommended optimizations.

## Checklist

### N+1 queries

- [ ] Generated list pages use `get{Entity}Page()` with a single paginated `findMany` — no per-row follow-up queries; Creator/Assignee filtering applied in the `WHERE AND` clause (`getters.ts.jinja2:buildEntityAccessWhere`)
- [ ] Creator/Assignee list filtering for restricted users — when `perms.general.read = false`, rows are filtered in the DB `WHERE` clause using `OR [{ creator_id: userId }, { assignee_id: userId }]`; NOT a post-fetch application-layer filter (this was the old pattern)
- [ ] Relation includes — generated `include:` props are explicit (only what the list/detail page needs); check for over-fetching if `include_props_list` includes deeply nested relations
- [ ] `getOrganizationAssociated()` — called before every `get{Entity}Page` on org-filtered models; adds one extra query; confirm it is cached or batched if called multiple times in a request
- [ ] Comment/attachment actions — these do NOT redirect, so they use `revalidatePath` + client `router.refresh()` to get fresh data; this is expected and correct per `docs/knowledge/performance-improvements.md`

### Missing indexes

- [ ] `user.tenant_id` — `@@index([tenant_id])` present (`prisma/schema.prisma:98`)
- [ ] `user.api_key` — `@@index([api_key])` present (`prisma/schema.prisma:96`)
- [ ] `user.creator_id` — `@@index([creator_id])` present (`prisma/schema.prisma:97`)
- [ ] `audit_log` — indexes on `actor_user_id`, `(target_table, target_id)`, `created_at` present (`prisma/schema.prisma:~286`)
- [ ] Generated entity models — each generated model has `@@index([creator_id])`; check whether models with `assignee_id` or `organization_id` also have indexes on those FK columns
- [ ] `mfa_recovery_code.user_id` — `@@index([user_id])` present (`prisma/schema.prisma:~305`)
- [ ] Soft-delete / status columns — if any generated model has a `status` or `deleted_at` column that appears in WHERE filters, verify an index exists

### Bundle size

- [ ] Redis rate limiter dynamically required — `lib/rate-limit/index.ts:getRateLimiter()` uses `require('./redis')` only when `REDIS_URL` is set; ioredis not in the client bundle
- [ ] `next/image` not used in upload/display components — `ImageDisplay`, `ImageUpload`, `ListWrapper`, `EditableListWrapper`, `OrderedEditableListWrapper` still use raw `<img>` (`next.config.ts` follow-up note); these components do not benefit from the AVIF/WebP pipeline
- [ ] `next.config.ts` image optimization configured — `formats: ['image/avif', 'image/webp']`, `minimumCacheTTL: 86400` set (`next.config.ts:~12`)
- [ ] MDX included in `pageExtensions` — `next.config.ts:pageExtensions` includes `md`/`mdx`; ensure MDX pages do not pull in large remark/rehype plugins unnecessarily
- [ ] `cacheComponents: true` commented out — `next.config.ts:~36`; consider enabling if React Server Component output can be shared across requests

### React optimization

- [ ] Generated pages use Streaming Suspense — outer sync shell renders instantly; inner async component awaits data; fallback is `<TableSkeleton>` or `<FormSkeleton>` defined inline in the template (`docs/knowledge/performance-improvements.md`, `page_list.tsx.jinja2`)
- [ ] `params` awaited in outer component for dynamic routes — edit/view pages: `const { id } = await params` in the outer async component before passing to inner Suspense child
- [ ] No `router.refresh()` in `handleBack` — removed from `FormUpsert.tsx` pattern; back navigation does not trigger extra `getDetail` + `getAllEntities` calls
- [ ] No `revalidatePath` in upsert/delete — `actions.ts.jinja2` `upsertEntity` calls only `redirect('/entity')`; the redirect itself invalidates the router cache; no double-fetch
- [ ] `getModelPermissions` returns `{ permissions, userId }` — no separate `getSessionUserId()` call; both fetched in one round-trip (`lib/authz.ts`)
- [ ] Parallel data + permissions — `Promise.all([getDetail(id), getModelPermissions()])` in `getEntityDetailPageData`; no sequential round-trips

### Large data handling

- [ ] Paginated list queries — `get{Entity}Page(opts, perms, userId)` in `getters.ts.jinja2` uses `clampPage(opts)` with `DEFAULT_PAGE_SIZE`; `skip`/`take` applied to every `findMany`
- [ ] Search results capped — `get{Entity}ForSearch()` limits to `safeLimit = Math.min(Math.max(limit, 1), 200)`
- [ ] No unbounded `findMany` in generated actions — `remove{Entity}()` fetches only `{ id, creator_id }` for the batch of provided ids, not the full row

### API response time

- [ ] JWT session reads off-DB — `session.strategy = "jwt"` means `auth()` in most routes resolves from the cookie without a DB round-trip (`auth.ts:~155`)
- [ ] API key TTL-LRU cache — `lib/api-auth.ts` caches `api_key → userId` for 5 minutes with a 1000-entry LRU cap (production only); dev/test bypass to avoid stale data after `db:reset`
- [ ] Vercel Tokyo DB latency — each sequential DB call adds ~500ms; the parallel fetch pattern (`Promise.all`) is critical to perceived performance per `docs/knowledge/performance-improvements.md`
- [ ] `select` projections — `get{Entity}Page` uses `include:` for relations but does not `select` specific scalar columns; for wide tables, adding explicit `select` reduces payload size

## Current implementation (proj_a specific)

**Streaming Suspense** is applied to all generated pages via `page_list.tsx.jinja2`, `page_edit.tsx.jinja2`, `page_new.tsx.jinja2`, `page_view.tsx.jinja2`. Every page has a sync outer component that returns `<Suspense fallback={<Skeleton>}>` and an async inner component that awaits the data getter. This gives fast TTFB (~0ms to shell) while the ~500ms Vercel Tokyo DB round-trip completes in the background.

**Parallel permissions + data**: `lib/authz.ts:getModelPermissions()` returns `{ permissions, userId }` so the session lookup and the permissions query are merged. Detail and list page data functions call `Promise.all([getData(), getModelPermissions()])` — saving one sequential DB round-trip compared to the original `getSessionUserId()` + `getModelPermissions()` + `getData()` chain.

**Eliminated redundant fetches**: `revalidatePath` removed from upsert/delete Server Actions (double-render eliminated). `router.refresh()` removed from `handleBack` (extra `getDetail` eliminated). Both fixes documented in `docs/knowledge/performance-improvements.md`.

**next/image**: `next.config.ts` enables AVIF/WebP and 24h cache TTL for images processed through `next/image`. Vercel Blob uploads are included in `remotePatterns`. However, the generated `ImageDisplay` and upload components use raw `<img>` tags and bypass this pipeline.

**N+1 protection**: paginated queries use `buildEntityAccessWhere()` to push Creator/Assignee filters into the DB `WHERE AND` clause — no post-fetch filtering for normal list pages. The `should_filter_by_org` path adds one extra `getAssociatedOrganizations()` call per page load.

## Known gaps / improvement areas

- **Raw `<img>` in 5 components** — `ImageDisplay`, `ImageUpload`, `ListWrapper`, `EditableListWrapper`, `OrderedEditableListWrapper` do not use `next/image`; uploaded images are served without AVIF/WebP conversion or TTL caching. Switching these to `next/image` with the configured `remotePatterns` is the fix.
- **`cacheComponents: true` commented out** — `next.config.ts:~36`; enabling React Server Component output caching would reduce re-renders for mostly-static pages; evaluate after switching to `next/image` (which interacts with the RSC cache).
- **Organization-filtered models add extra query** — `getAssociatedOrganizations(userId)` is called on every page load for org-filtered entities; result is not cached across the request. A React `cache()` wrapper or request-scoped memoization would eliminate redundant calls if multiple getters run in the same request.
- **Wide-table `include` without `select`** — generated `getters.ts` uses `include:` for relations but fetches all scalar columns; for entities with many fields, explicit `select` projections would reduce DB payload.
- **No DB-level index on `assignee_id`** — generated models with `assignee_id` are filtered in the `WHERE OR` clause, but verify `@@index([assignee_id])` exists in each generated schema; missing index causes full table scan for assignee-restricted users.

## Completion gate

1. `npm audit --omit=dev --audit-level=high`

## Input
$ARGUMENTS

> When running lint/typecheck in isolation, prefix with `npm run generate-code`.
> See `.codex/rules/generated-code-gates.md` for details.
