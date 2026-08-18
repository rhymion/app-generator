# Bridge Interface Design

This document records the design decisions for the polymorphic bridge (`x-bridge`) UI interface,
covering parent label resolution, child CRUD placement, read-only handling, and the parent-embedded
DataGrid pattern. Approved decisions: AP-1 through AP-3, plus later hands-on feedback.

See also: `docs/knowledge/schema-yaml-configuration.md` §7.6 for the schema declaration reference.

---

## AP-1: Parent Label Resolution

Each parent type listed in `x-bridge.parents` may use a different field as its display label.
The resolution priority is:

1. `labelField` declared in `x-bridge.parents[].labelField` — highest priority, always wins
2. `x-display.primary` field on the parent entity — second priority
3. Fallback scan in order: `name` → `title` → `label` → `id`

**Schema example:**

```yaml
channel:
  x-bridge:
    name: channelable
    child: channel
    parentCardinality: exactlyOne
    parents:
      - role: work_hub
        target: work
        labelField: title      # work uses "title" as its primary label
      - role: character_hub
        target: character
        labelField: name       # character uses "name"
      - role: scene_hub
        target: scene
        labelField: label      # scene uses "label"
```

The resolved label is shown wherever the parent identity is displayed — in child forms, child
list columns, and the bridge context header.

---

## AP-2: Child CRUD Placement

**Decision: parent-owned CRUD only.**

- Standalone "create new child" buttons on the child's own list page are **disabled** when the
  child requires a parent via the bridge.
- All child CRUD (create, edit, delete) is initiated from the **parent's edit page**.
- Child create and edit pages are opened as separate navigated pages, not inline dialogs.
  Navigation carries the parent context (`parentType` + `parentId`) implicitly.
- A child cannot be created without an established parent context.

**Example flow:**

```
/work/edit/[id]          ← parent edit page
  └─ "Add Channel" →     ← creates child bound to this work
     /channel/new?parentType=work&parentId=[id]

/work/edit/[id]
  └─ row "Edit" →        ← edits child, parent is read-only
     /channel/edit/[childId]
```

---

## AP-3: Read-Only Parent Fields in Child Forms

**Decision: parent fields are always read-only in child context; submit rejects any mutation.**

When a child form is opened from a parent's edit page, all parent-identifying fields
(parent type, parent label) are displayed as read-only. The child's `service.ts` validates
on submit: if the incoming `parentType` / `parentId` differs from the stored bridge value,
the request is rejected with a validation error.

This prevents silent parent-switching via form manipulation. The child's parent is permanently
fixed at creation time.

---

## Extension 1: `x-readonly` Property (RO-C)

A field-level annotation to mark a property as non-editable in generated forms.

```yaml
some_entity:
  properties:
    parent_label:
      type: string
      x-readonly: true    # generator renders this as a read-only display field, not an input
```

**Generator behaviour:**
- In `FormUpsert.tsx`: the field is rendered as a disabled text display (no input element).
- In `FormView.tsx`: no change — all fields are already read-only in view pages.
- `x-readonly` is independent of `required` and validation constraints.

**Usage in the bridge context:** parent type and parent label fields injected into the child form
carry `x-readonly: true` so the generator automatically makes them non-editable.

---

## Extension 2: Parent Always Read-Only in Child Edit Page

When a child edit page is opened in bridge context, the page header always shows:

```
Parent: {parentType} ({parentLabel})
```

Example: `Parent: work (My Story Arc)`

This context display:
- Is rendered at the top of the child form, above the editable fields.
- Uses the resolved label from AP-1 for `{parentLabel}`.
- Is never an editable field — it is purely informational.
- Appears in both the child's `new` and `edit` pages when `parentType` / `parentId` are present
  as query parameters or stored bridge data.

---

## Child List Display

Bridge children are listed in a **DataGrid** embedded in the parent's edit page.

- Columns are driven by the child's `x-display.table` configuration.
- If `x-display.table` is absent, the generator falls back to scalar field defaults.
- The DataGrid is rendered in `FormUpsert.tsx` of the parent entity.
- Edit and Delete buttons appear per row (navigating to the child's edit page with parent context).
- For **read-only bridges** (parent cannot own mutable children), Edit and Delete buttons are hidden.

**Recommendation:** always define `x-display.table` on a bridge child to control the embedded
grid columns explicitly.

---

## Parent Detail Page

On the parent's **view page** (`FormView.tsx`):

- Enum fields are displayed as their string label (e.g. `"In Progress"` not `2`).
  The generator maps the stored integer index to the `enum` label array at render time.
- The bridge child list is rendered as a read-only DataGrid (no add/edit/delete buttons),
  showing the same columns as `x-display.table`.

---

## Removal of the Generic "+" Button

The generic add (`+`) button pattern — where any child type can be added from a top-level
button without parent context — is **removed** for bridge children.

**Rationale:** a bridge child always belongs to exactly one parent. Creating one without a
parent context violates `parentCardinality: exactlyOne` and produces a corrupt bridge row.

**Replacement:** child creation is only reachable from:
1. The "Add {Child}" button inside the parent's embedded DataGrid (carries parent context), or
2. Direct navigation to `/child/new?parentType=…&parentId=…` (parent context in query params).

Any code path that renders a create button for a bridge child without checking for parent
context must be removed during the child's page generation.

---

## Summary of Decisions

| Decision | Ruling |
|----------|--------|
| AP-1: Parent label source | `labelField` → `x-display primary` → name/title/label/id |
| AP-2: Child CRUD location | Parent edit page only; child form = separate page with parent context |
| AP-3: Read-only enforcement | Parent fields always read-only; submit rejects parent mutation |
| Extension 1: `x-readonly` | Field-level property; generator renders non-editable display field |
| Extension 2: Parent context header | Always shown at top of child new/edit when in bridge context |
| Child list rendering | DataGrid in parent `FormUpsert` + `FormView`; columns from `x-display.table` |
| Parent detail enum display | String label, not integer index |
| Generic "+" removal | Removed; child creation only via parent-context entry points |
