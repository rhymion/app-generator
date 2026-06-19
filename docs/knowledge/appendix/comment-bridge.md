# Comment Bridge System

> **Source**: Extracted from `docs/knowledge/schema-yaml-configuration.md §17`.
> For the main schema configuration reference, see the parent document.

The comment system uses the same bridge entity pattern as the approval flow. A single `comment`
model handles comments for all entities via a `commentable` bridge. Any entity can have a comment
thread by adding a one-to-one relationship to `commentable`.

### 17.1 System entities

These definitions must be present in every application schema:

```yaml
commentable:
  type: object
  required: [id]
  properties:
    id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"

commentable_detail:
  x-generate:
    list: false
    view: false
    new: false
    edit: false
    delete: false
    invalidate: false
    api: false
    test: false
  allOf:
    - $ref: "#/definitions/commentable"
    - type: object
      required: [comments]
      properties:
        comments:
          type: array
          x-outputType: comments
          items:
            $ref: "#/definitions/comment"

comment:
  type: object
  required: [id, message, commentable_id]
  properties:
    id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
    message:
      type: string
      minLength: 1
    commentable_id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
```

The corresponding Prisma models:

```prisma
model commentable {
  id       String    @id @default(cuid())
  comments comment[]
  // back-relations from each entity using commentable
  db_table db_table?
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

Add a `commentable_id` FK with `x-relationship: type: one-to-one` to the entity's base definition,
and reference `commentable_detail` in the detail definition:

```yaml
db_table:
  type: object
  required: [id, name, commentable_id]
  properties:
    commentable_id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
      x-relationship:
        type: one-to-one
        target: commentable
        labelField: id

db_table_detail:
  allOf:
    - $ref: "#/definitions/db_table"
    - type: object
      properties:
        commentable:
          $ref: "#/definitions/commentable"
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
| Pattern | Direct child in `_detail` | One-to-one rel in entity + `commentable` in detail |

Both patterns produce identical runtime behavior for the end user.

---

## §2 Comment Reactions

The reaction system extends comments with a lightweight engagement model. Reactions are
implemented as a sub-entity of `comment` with generator-driven UI and a dedicated toggle endpoint.

### 2.1 Schema definition (integer enum)

Reaction types are represented as integer enums in `json_schema.yaml`:

```yaml
reaction:
  type: object
  x-internal:
    page: false
    embed: false
    api: custom
  required: [id, type, comment_id]
  properties:
    id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
    type:
      type: integer
      minimum: 1
      maximum: 5
      x-enum-labels: [like, heart, laugh, wow, sad]
    comment_id:
      type: string
      pattern: "^c[a-z0-9]{24,}$"
```

The `x-enum-labels` array maps each integer value to a human-readable label (index 0 = value 1).
The generator produces `lib/{entity}/reaction_constants.ts` with named constants:

```typescript
// Auto-generated — do not edit
export const REACTION_LIKE  = 1;
export const REACTION_HEART = 2;
export const REACTION_LAUGH = 3;
export const REACTION_WOW   = 4;
export const REACTION_SAD   = 5;
```

UI, API handlers, and tests all import from this file, preventing label-to-integer drift.

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
{ "type": 1 }
```

**Response:**
```json
{
  "active": true,
  "counts": { "1": 5, "2": 3 }
}
```

The handler checks whether the authenticated user already has a reaction of the given type on the
comment. If absent, it inserts; if present, it deletes. Either path returns the updated `active`
flag and the full counts map keyed by reaction type integer.

### 2.4 Batched groupBy aggregation

Fetching reaction counts uses a batched `groupBy` strategy to avoid N+1 queries:

**Comment list (batch):**
```typescript
// One query for all visible comment ids
const counts = await prisma.reaction.groupBy({
  by: ['comment_id', 'type'],
  where: { comment_id: { in: commentIds } },
  _count: { _all: true },
});
```

**After toggle (single comment):**
```typescript
const counts = await prisma.reaction.groupBy({
  by: ['type'],
  where: { comment_id: commentId },
  _count: { _all: true },
});
```

This eliminates denormalized counter columns (and their consistency risks) while keeping query
count to O(1) per page load regardless of comment count.

### 2.5 Named constants generation

The generator reads `x-enum-labels` from the reaction schema and emits:

```
lib/{parent_entity}/reaction_constants.ts
```

The file is regenerated on every `generate-code` run. Consumers import from it:
```typescript
import { REACTION_LIKE, REACTION_HEART } from '@/lib/post/reaction_constants';
```

This ensures UI, API routes, and test fixtures stay in sync with the schema definition.

### 2.6 Cascade behavior

Reaction records are low-value interaction state and are deleted automatically:

| Trigger | Cascade target |
|---------|----------------|
| `comment` deleted | All reactions for that comment |
| `user` deleted | All reactions created by that user |

The Prisma schema uses `onDelete: Cascade` on both foreign keys:

```prisma
model reaction {
  id         String  @id @default(cuid())
  type       Int
  comment_id String
  comment    comment @relation(fields: [comment_id], references: [id], onDelete: Cascade)
  creator_id String
  creator    user    @relation(fields: [creator_id], references: [id], onDelete: Cascade)

  @@unique([comment_id, creator_id, type])
}
```

### 2.7 Read authorization

Reaction visibility follows the parent comment's access rules:

- **Read reactions**: inherits the read permission of the parent comment's owner entity (e.g.,
  if a comment belongs to a `post`, users who can read that `post` can also read its reactions).
- **Toggle (add/remove)**: any authenticated user may toggle a reaction, subject to the parent
  entity's read permission being satisfied first.

The generator emits an authorization check in the toggle handler that resolves the parent entity's
read permission before allowing the operation.

### 2.8 CommentReactionBar component

The generator produces a `CommentReactionBar` component embedded in every comment list:

```tsx
// Auto-generated component
export function CommentReactionBar({ commentId, counts, myReactions }: CommentReactionBarProps) {
  const reactionTypes = [REACTION_LIKE, REACTION_HEART, REACTION_LAUGH, REACTION_WOW, REACTION_SAD];
  return (
    <Stack direction="row" spacing={0.5}>
      {reactionTypes.map((type) => (
        <ReactionButton
          key={type}
          type={type}
          count={counts[type] ?? 0}
          active={myReactions.includes(type)}
          onToggle={() => toggleReaction(commentId, type)}
        />
      ))}
    </Stack>
  );
}
```

The component receives:
- `counts`: the groupBy aggregation result (type → count map)
- `myReactions`: the current user's active reaction types for this comment
- `onToggle`: calls `POST /api/comment/{commentId}/reactions/toggle`
