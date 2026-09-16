# Comment Bridge System

> **Source**: Extracted from `docs/knowledge/schema-yaml-configuration.md §17`.
> For the main schema configuration reference, see the parent document.

The comment system uses the same bridge entity pattern as the approval flow. A single `comment`
model handles comments for all entities via a `commentable` bridge. Any entity can have a comment
thread by adding a one-to-one relationship to `commentable`.

### 17.1 System entities

`commentable` and `comment` are framework-default entities, already declared in
`code_generator/json_schema_internal.yaml` in the current **single-file entity format**
(no separate `_detail` definition — see `docs/knowledge/schema-yaml-configuration.md` §2).
Most projects never need to touch these:

```yaml
# code_generator/json_schema_internal.yaml (framework default — merged in automatically;
# copy an entity's definition into your own json_schema.yaml only to customize it)
commentable:
  x-generate:
    list: false
    view: false
    new: false
    edit: false
    delete: false
    invalidate: false
    api: false
    test: false
  required: [comments]
  properties:
    comments:
      type: array
      x-outputType: comments
      items:
        $ref: "#/definitions/comment"

# your own json_schema.yaml
comment:
  fields:
    message:
      x-mention: true
    commentable_id: {}
```

The corresponding Prisma models:

```prisma
model commentable {
  id       String    @id @default(cuid())
  comments comment[]
  // back-relations from each entity using commentable
}

model comment {
  id             String      @id @default(cuid())
  message        String
  commentable_id String
  commentable    commentable @relation(fields: [commentable_id], references: [id], onDelete: Cascade)
  created_at     DateTime    @default(now()) @db.Timestamptz(0)
  updated_at     DateTime    @updatedAt @db.Timestamptz(0)
  creator_id     String
  creator        user @relation("CommentCreator", fields: [creator_id], references: [id])
}
```

### 17.2 Making an entity commentable

Add a `commentable_id` FK with `x-relationship: type: one-to-one` directly on the entity —
there is no separate detail definition to add it to (single-file format, same auto-create
pattern as `approvable`; see `docs/knowledge/schema-yaml-configuration.md` §12.5):

```yaml
db_table:
  fields:
    commentable_id:
      x-relationship:
        type: one-to-one
        target: commentable
        labelField: id
  properties:
    commentable:
      $ref: "#/definitions/commentable"   # resolved object included in detail queries
```

The `one-to-one` relationship triggers pre-creation of the `commentable` bridge in `$transaction`
before the parent entity is created (same mechanism as `approvable`).

### 17.3 Generated code

**`service.ts` include:** The generator detects the `commentable` one-to-one rel and adds:
```typescript
commentable: {
  include: {
    comments: {
      include: { creator: { select: { id: true, name: true, avatar: true } } },
      orderBy: { created_at: 'asc' }
    }
  }
}
```

**`actions.ts`:** Entity-specific wrappers are generated using the bridge pattern:
```typescript
export async function addDbTableComment(commentable_id: string, message: string): Promise<void> {
  const { userId } = await requireAuth();
  await prisma.comment.create({ data: { message, commentable_id, creator_id: userId } });
  revalidatePath('/db_table');
}
export async function updateDbTableComment(commentId: string, message: string): Promise<void> { ... }
export async function deleteDbTableComment(commentId: string): Promise<void> { ... }
```

**`FormUpsert.tsx`:** Comment section uses `src.commentable!.id` as the bridge ID:
```tsx
const handleCreateComment = async (message: string) => {
  await addDbTableComment(src.commentable!.id, message);
  router.refresh();
};
```

The `CommentListWrapper` reads from `src.commentable?.comments ?? []`.

### 17.4 Difference from per-entity comment models

| Aspect | Per-entity (`epic_comment`) | Bridge (`comment` via `commentable`) |
|---|---|---|
| Schema | One comment model per entity | Single `comment` model for all |
| FK | `epic_id` on `epic_comment` | `commentable_id` on `comment` |
| Action arg | parent entity id (`src.id`) | bridge id (`src.commentable!.id`) |
| Prisma cascade | `epic` → `epic_comment` | `commentable` → `comment` |
| Pattern | Direct child, listed in the entity's own `properties:` | One-to-one rel on the entity + `commentable` resolved in `properties:` |

Both patterns produce identical runtime behavior for the end user.

---

## §2 Comment Reactions

The reaction system extends comments with a lightweight engagement model. Reactions are
implemented as a sub-entity of `comment` with generator-driven UI and a dedicated toggle endpoint.

### 2.1 Schema definition (native string enum — promoted from a legacy integer enum)

This section originally described `reaction.type` as an integer enum with an
`x-enum-labels` index→label map. That has since been promoted to a Prisma
nativeEnum (string) — the same integer-enum-to-nativeEnum promotion pattern
that later affected DataGrid-child default handling elsewhere in this
generator. `x-enum-labels` no longer appears anywhere in this field's
declaration. This repo's own `code_generator/json_schema.yaml` (single-file
format, no `_detail` suffix) declares it as (~line 396):

```yaml
reaction:
  x-internal:
    page: false
    embed: false
    api: custom
  fields:
    type:
      enum:
        - like
        - love
        - laugh
        - surprised
        - sad
    user_id:
      x-relationship: {}
    comment_id:
      x-relationship:
        labelField: id
        constantParent: true
```

Note the actual label set is `like/love/laugh/surprised/sad` — two of the five differ
from what this doc previously showed (`heart`→`love`, `wow`→`surprised`).

`prisma/schema.prisma` declares the matching Prisma enum and model:

```prisma
enum ReactionType {
  like
  love
  laugh
  surprised
  sad
}

model reaction {
  id          String       @id @default(cuid())
  type        ReactionType
  user_id     String
  user        user         @relation("ReactionUser", fields: [user_id], references: [id])
  comment_id  String
  comment     comment      @relation(fields: [comment_id], references: [id], onDelete: Cascade)
  created_at  DateTime     @default(now()) @db.Timestamptz(0)
  updated_at  DateTime     @updatedAt @db.Timestamptz(0)

  @@unique([comment_id, user_id, type])
  @@index([user_id])
  @@index([comment_id])
}
```

The reactor's FK is `user_id`/`user` (relation name `"ReactionUser"`), not
`creator_id`/`creator` as this doc previously showed (see §2.6 below, also fixed).

`code_generator/generate_types.py`'s `extract_named_constants()` (accepts both
the legacy plain-integer shape and the current nativeEnum/string shape — its own
docstring names this exact promotion path) produces one constant per
`x-internal` entity with an enum field, named `{PARENT}_{ENTITY}_TYPES` where
`{PARENT}` is whichever FK target is marked `x-relationship: {constantParent: true}`
— here, `comment` (via `comment_id`). So the generated file is:

```typescript
// Auto-generated — do not edit manually.
export const COMMENT_REACTION_TYPES = [
  { value: 'like', label: 'like' },
  { value: 'love', label: 'love' },
  { value: 'laugh', label: 'laugh' },
  { value: 'surprised', label: 'surprised' },
  { value: 'sad', label: 'sad' },
] as const;
export type COMMENT_REACTION_TYPE = typeof COMMENT_REACTION_TYPES[number];
```

Not five separate `REACTION_LIKE = 1`-style numeric constants — one array
constant of `{value, label}` pairs, string-valued, named after the constant
parent entity rather than the reaction entity itself
(`code_generator/templates/reaction_constants.ts.jinja2`). UI, API handlers, and
tests all import from `lib/reaction_constants.ts` (not `lib/{entity}/reaction_constants.ts`
— it's a single project-wide file, not per-entity), preventing label drift.

### 2.2 x-internal classification

`reaction` is an **x-internal third-class** entity:

```yaml
reaction:
  x-internal:
    page: false    # no standalone list/edit page generated
    embed: false   # no DataGrid embed in parent pages
    api: custom    # only the toggle endpoint is generated; standard CRUD API is omitted
```

This differs from `x-internal: true` (which suppresses all output) and from standard entities
(which generate full CRUD UI). The `api: custom` value tells the generator to skip normal REST
handlers and rely on the hand-specified toggle endpoint instead.

### 2.3 Toggle endpoint

A single idempotent endpoint handles both add and remove:

```
POST /api/comment/{commentId}/reactions/toggle
```

**Request body:**
```json
{ "type": "like" }
```
(a string value now that `type` is a nativeEnum — see §2.1 — not the integer `1` shown here
previously)

**Response** — confirmed against `code_generator/templates/comment_reactions_api_route.ts.jinja2`'s
`CommentReactionSummary` type and its `GET` handler:
```json
{
  "commentId": "...",
  "type": "like",
  "active": true,
  "counts": [ { "type": "like", "count": 5 }, { "type": "love", "count": 3 } ],
  "myTypes": ["like"]
}
```
`counts` is an **array** of `{ type, count }` pairs, not an object keyed by reaction type as this
doc previously showed — computed via `prisma.reaction.groupBy({ by: ['type'], where: { comment_id },
_count: { type: true } })`, mapped to `{ type: r.type, count: r._count.type }`.

The handler checks whether the authenticated user already has a reaction of the given type on the
comment. If absent, it inserts; if present, it deletes. Either path returns the updated `active`
flag and the full counts array.

### 2.4 Batched groupBy aggregation

Fetching reaction counts uses a batched `groupBy` strategy to avoid N+1 queries:

**After toggle / single comment (confirmed, `comment_reactions_api_route.ts.jinja2`):**
```typescript
const rawCounts = await prisma.reaction.groupBy({
  by: ['type'],
  where: { comment_id: commentId },
  _count: { type: true },
});
const counts = rawCounts.map((r) => ({ type: r.type, count: r._count.type }));
```
`_count: { type: true }`, not `_count: { _all: true }` as this doc previously showed.

**Comment list (batch, `getCommentReactions`):** the function is registered in
`build_context.py` (`reaction_batch_query`, `strategy: "batched_group_by"`) but its
generated body was not located in this pass — its exact `groupBy` call shape (whether it
also uses `_count: { type: true }` and a `by: ['comment_id', 'type']` grouping) is **unknown**,
not independently re-confirmed here. Treat the doc's previous `by: ['comment_id', 'type']` /
`_count: { _all: true }` shape for this specific batch path as unverified rather than corrected.

This eliminates denormalized counter columns (and their consistency risks) while keeping query
count to O(1) per page load regardless of comment count.

### 2.5 Named constants generation

Superseded by §2.1 above (this used to be a separate claim but described the same
mechanism): the generator no longer reads `x-enum-labels` for this field — it reads the
plain `enum:` list off whichever `x-internal` entity has an enum-typed field, string or
integer (`generate_types.py`'s `extract_named_constants()`). The output path is a single
project-wide `lib/reaction_constants.ts` (not `lib/{parent_entity}/reaction_constants.ts`
— there is one constants file for the whole project, not one per parent entity), and the
constant inside it is named after the constant-parent entity
(`COMMENT_REACTION_TYPES`), not after the reaction entity itself
(`REACTION_LIKE`/`REACTION_HEART` don't exist):
```typescript
import { COMMENT_REACTION_TYPES } from '@/lib/reaction_constants';
```
This still ensures UI, API routes, and test fixtures stay in sync with the schema definition —
only the constant's name, shape, and file path have changed.

### 2.6 Cascade behavior

Reaction records are low-value interaction state and are deleted automatically:

| Trigger | Cascade target |
|---------|----------------|
| `comment` deleted | All reactions for that comment |
| `user` deleted | All reactions by that user |

The actual field name for the reacting user is `user_id`/`user` (relation name
`"ReactionUser"`), not `creator_id`/`creator` as previously shown — see the full model in
§2.1. `onDelete: Cascade` is on the `comment` FK; the `user` relation as declared in this
repo's `prisma/schema.prisma` (§2.1) has no explicit `onDelete` modifier, which defaults to
`Restrict` in Prisma, not `Cascade` — this doc's "user deleted → reactions cascade" claim is
not confirmed against this repo's actual schema and should be treated as **unknown** for the
`user_id` FK specifically (the `comment_id` FK's cascade is confirmed).

### 2.7 Read authorization

Reaction visibility follows the parent comment's access rules:

- **Read reactions**: inherits the read permission of the parent comment's owner entity (e.g.,
  if a comment belongs to a `post`, users who can read that `post` can also read its reactions).
- **Toggle (add/remove)**: any authenticated user may toggle a reaction, subject to the parent
  entity's read permission being satisfied first.

This doc previously claimed "the generator emits an authorization check in the toggle handler
that resolves the parent entity's read permission." That is not accurate for the API route
specifically: `comment_reactions_api_route.ts.jinja2`'s own comment states this owner-entity
read check is **not implemented** in that route — it authenticates via API key only and
explicitly defers the parent-entity read-permission check to the server-action layer
(`actions.ts`), tracking the API-route version as a pending, undecided item. Read-permission
enforcement for the toggle happens at the server-action call site, not inside a
generically-emitted check in the toggle handler itself.

### 2.8 CommentReactionBar component

`CommentReactionBar` is a **hand-written shared component**
(`components/_standard/CommentReactionBar.tsx`), not a per-entity generated one — it carries
no "Auto-generated" marker and isn't rendered from a `.jinja2` template; every entity's
generated JSX imports and calls this same fixed component (analogous to `EditableListWrapper`
in the many-to-many doc). Its actual exported types are:
```typescript
export type CommentReactionCount = { type: string | number; count: number };
export type CommentReactionSummary = {
  commentId: string;
  type: string | number;
  active: boolean;
  counts: CommentReactionCount[];
  myTypes: (string | number)[];
};
export type ReactionType = { value: string | number; label: string };
```
`counts` is a `CommentReactionCount[]` array (`{ type, count }` pairs), not a `type → count`
map, and the "active reaction types" field is named `myTypes`, not `myReactions`. The
component's actual prop/rendering internals were not traced line-by-line in this pass; treat
the illustrative JSX previously shown here as unconfirmed pseudocode, superseded by the type
shapes above.
