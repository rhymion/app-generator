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
