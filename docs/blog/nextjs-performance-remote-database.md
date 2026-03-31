# Improving Next.js App Router Performance with a Remote Database

When your Next.js application connects to a database hosted in a distant region,
latency becomes the dominant factor in page load time. A single DB round-trip
might cost 500ms or more — and every sequential call stacks that cost visibly
for the user. This article walks through four techniques that, together, make
a significant difference in perceived and actual performance.

---

## The Problem: Sequential Waits Add Up

A typical data page in a Next.js App Router application does something like this:

1. Check who the current user is (auth lookup)
2. Fetch the user's permissions for this resource
3. Fetch the actual data

If each of these is a separate DB call and each costs 500ms, the user waits
1.5 seconds before seeing anything. On top of that, the entire HTML response is
held until all three complete — meaning the browser has nothing to render until
everything is done.

The following techniques address this at three levels: what the browser renders
first, which calls run in parallel, and how many calls happen at all.

---

## Technique 1: Stream Content with Suspense

### The idea

Next.js App Router supports streaming HTML responses. If you wrap an async
server component in a `<Suspense>` boundary, Next.js sends the outer HTML
shell to the browser immediately — without waiting for the data — then streams
in the content when it's ready.

The key is to split every data-fetching page into two parts:

- A **sync outer component** that returns instantly (no awaits, no DB calls)
- An **async inner component** that does the actual data fetching

```tsx
// The outer component renders immediately — fast first byte
export default function ProductListPage() {
  return (
    <Suspense fallback={<LoadingPlaceholder />}>
      <ProductListContent />
    </Suspense>
  );
}

// The inner component streams in when data is ready
async function ProductListContent() {
  const products = await getProducts();
  return <ProductTable rows={products} />;
}
```

Without this split, the page component itself is async, which blocks the
entire response. With it, the browser receives the page shell — including
layout, navigation, and the loading placeholder — at near-zero latency.
The content then streams in when the DB responds.

### Pages with dynamic route parameters

For pages like `/products/[id]/edit`, the route params need to be awaited.
The cleanest pattern is to await params in the outer component and pass the
resolved values down:

```tsx
export default async function ProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<LoadingPlaceholder />}>
      <ProductEditContent id={id} />
    </Suspense>
  );
}
```

---

## Technique 2: Show Skeleton Screens While Loading

### The idea

Streaming Suspense gives the browser something to work with immediately, but
what does the user actually see while waiting? A blank area or a generic spinner
is disorienting. A skeleton screen — a low-fidelity outline of the content to
come — signals to the user exactly where the content will appear, making the
wait feel shorter.

MUI's `<Skeleton>` component makes this straightforward:

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

The skeleton matches the shape of the real content: a header row followed by
data rows. When the actual table streams in, there's no layout shift — the
skeleton was already occupying the right space.

The same approach works for form pages:

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

Skeleton screens don't reduce actual load time, but they meaningfully improve
perceived performance — which is what users notice.

---

## Technique 3: Fetch Data and Permissions in Parallel

### The problem with sequential auth

A common pattern for protected pages looks like this:

```ts
// Three sequential round-trips
const userId = await getCurrentUserId();
const permissions = await getPermissions(userId, 'product');
const products = await getProducts();
```

The permissions call depends on `userId`, so it can't start until the first
call finishes. The data fetch is independent but happens last. On a remote DB,
this stacks three round-trips end-to-end.

### Rethinking the auth API

The fix starts by reconsidering what the auth/permissions API returns. If the
function that resolves permissions also returns the `userId` it resolved, the
caller can eliminate the separate `getCurrentUserId()` call — and use
`Promise.all` to run permissions and data fetches concurrently:

```ts
// One round-trip for both
const [{ permissions, userId }, products] = await Promise.all([
  getPermissions('product'),   // now returns { permissions, userId } together
  getProducts(),
]);
```

For detail pages (where permissions may depend on the item's creator or
assignee), the item and base permissions can still be fetched in parallel.
The item-level permission resolution happens afterward, once both are available:

```ts
const [item, { permissions: basePermissions, userId }] = await Promise.all([
  getProduct(id),
  getPermissions('product'),
]);

// Resolve item-specific permissions (creator/assignee rules) — no extra DB call
const finalPermissions = resolveItemPermissions(basePermissions, item, userId);
```

This pattern turns what was three sequential DB calls into effectively one
parallel round-trip, saving two full DB latency cycles on every page load.

### Keeping component interfaces simple

The internal permission object may carry rich context (general role, creator
role, assignee role) for server-side resolution. Components don't need this
detail — they just need four booleans: can read, create, update, delete. Strip
the rich object down before passing it to components:

```ts
// Server: resolve rich permissions
const finalPermissions = resolveItemPermissions(basePermissions, item, userId);

// Pass simplified flags to the component
return <ProductForm permissions={toSimpleFlags(finalPermissions)} />;
```

This keeps the server logic flexible while keeping component props clean.

---

## Technique 4: Avoid Unnecessary Cache Invalidation

Even after optimizing what happens on the first load, extra DB calls can sneak
in through cache invalidation logic. Two common sources:

### Double-fetch from `revalidatePath` + `redirect`

In a Next.js Server Action, it's tempting to both invalidate the cache and
redirect after a successful save:

```ts
export async function saveProduct(data: FormData) {
  await upsertProduct(data);
  revalidatePath('/products');  // invalidate
  redirect('/products');        // navigate
}
```

The problem is that `revalidatePath` schedules a background re-render of
`/products`, and `redirect` causes the client to navigate to `/products` —
which also triggers a render. The result is two DB calls for the list page
in rapid succession.

The fix: remove `revalidatePath`. The `redirect()` call in a Server Action
already invalidates the router cache for the destination, so `revalidatePath`
is redundant here:

```ts
export async function saveProduct(data: FormData) {
  await upsertProduct(data);
  redirect('/products');  // handles cache invalidation + navigation together
}
```

### Extra fetch from `router.refresh()` in navigation handlers

A similar issue appears in client-side navigation. It's common to call both
`router.push()` and `router.refresh()` when a form's back button is clicked:

```ts
// Before: causes extra fetches
const handleBack = () => {
  router.push('/products');
  router.refresh();  // triggers getProductDetail AND getProducts
};
```

The `router.refresh()` re-renders the current page before navigation completes,
firing DB calls that are about to be discarded as the user leaves. Remove it:

```ts
// After: clean navigation, no extra fetches
const handleBack = () => {
  router.push('/products');
};
```

The destination page fetches its own fresh data when it mounts.

### When `revalidatePath` is still needed

Some actions don't redirect — they update the current page in place. Comment
CRUD, status toggles, and similar in-place updates fall into this category.
These still need `revalidatePath` because the client calls `router.refresh()`
to pick up changes, and the server needs its cache invalidated for that
refresh to return fresh data:

```ts
export async function addComment(productId: string, text: string) {
  await createComment({ productId, text });
  revalidatePath('/products');  // needed: no redirect, client will call router.refresh()
}
```

The rule: use `revalidatePath` when there is no `redirect`. Drop it when there is.

---

## Results and Trade-offs

These four techniques work at different layers and complement each other:

| Technique | Latency saved | Mechanism |
|---|---|---|
| Streaming Suspense | Fast TTFB regardless of DB latency | Shell rendered before DB responds |
| Skeleton screens | Perceived wait reduced | Visual placeholder during loading |
| Parallel data + permissions | ~1–2× DB round-trips eliminated | `Promise.all` instead of sequential awaits |
| Remove redundant invalidation | 1–2 extra renders eliminated per navigation | `redirect` instead of `revalidatePath` + `redirect` |

The parallelism improvement (Technique 3) requires some thought about API
design — specifically making auth functions return enough context to avoid a
separate userId lookup. The cache invalidation improvements (Technique 4) are
mostly a matter of understanding what `revalidatePath` and `redirect` each do
and avoiding the overlap.

Streaming + skeletons are largely mechanical: split the page component, add
a `<Suspense>` boundary, provide a meaningful fallback. These changes don't
require touching any business logic and can be applied incrementally.

Together, on an application with ~500ms DB round-trips, these changes can
reduce the wait before something interactive appears from several seconds to
near-zero (skeleton is immediate), and cut total DB calls on common navigation
patterns by half.
