# Bridge Interface Design

This document records the design decisions for the polymorphic bridge (`x-bridge`) UI interface,
covering parent label resolution, child CRUD placement, read-only handling, and the parent-embedded
DataGrid pattern. Approved decisions: AP-1 through AP-3, plus later hands-on feedback.

See also: `docs/knowledge/schema-yaml-configuration.md` §7.6 for the schema declaration reference.

---

## AP-1: Parent Label Resolution

Each parent type listed in `x-bridge.parents` may use a different field as its display label.
The resolution priority is (`code_generator/build_context.py:1599-1626`, explicitly labeled AP-1-A/B in
the source comments):

1. `labelField` declared in `x-bridge.parents[].labelField` — highest priority, always wins (AP-1-A)
2. The field marked `primary: true` inside the parent entity's `x-display.table` column list —
   second priority (AP-1-B; this is a per-column flag within `x-display.table`, not a separate
   top-level `x-display.primary` key)
3. Fallback scan in order: `name` → `title` → `label` → `id` (whichever exists first on the target;
   `id` if none do)

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

**Decision: parent fields are always read-only in child context; there is nothing in the edit form
that could submit a different parent.**

The actual mechanism is stronger than a runtime submit-time check — it's a structural exclusion,
not a validation rule. `parent_type` / `parent_label` are virtual, computed-only fields (added by
`code_generator/context.py:307-317`, populated in `getters.ts` from the bridge parent's own
include, never stored as a writable Prisma column). In the child's edit form
(`code_generator/generators.py:5418-5433`) they render as two plain read-only `AppFieldText`
fields (`tf('parentType')` / `tf('parentLabel')`) with no `Ref` wiring them into `formData` — there
is no input for a user to change, and no `parentType`/`parentId` value is ever submitted from the
edit form at all. Separately, the bridge's own FK column (the real link to the parent row) is
auto-added to the child's `readonly_fields` (`build_context.py`'s "Stage 2: auto-add bridge FK prop
to readonly_fields"), so it follows the same generic write-exclusion as any other readonly field.

This prevents silent parent-switching via form manipulation. The child's parent is permanently
fixed at creation time — enforced by there being no writable field for it in the edit form, not by
a service-layer comparison-and-reject check.

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

## Extension 2: Parent Context in Child Edit Page (edit only — not a single combined header)

The actual generated UI (`code_generator/generators.py:5418-5433`) is two separate read-only
`AppFieldText` fields, not one combined "Parent: {type} ({label})" header line:

```tsx
<AppFieldText label={tf('parentType')} value={src.parent_type ?? ''} readOnly />
<AppFieldText label={tf('parentLabel')} value={src.parent_label ?? ''} readOnly />
```

This context display:
- Is rendered at the top of the child form's field list (`all_parent_fields_jsx`), above the other
  editable fields — **only in edit mode (`isEdit`)**.
- `src.parent_label` is pre-resolved server-side using AP-1's priority (`getters.ts` builds it from
  the bridge parent's own include; see AP-1 above); the client does not compute it.
- Is never an editable field — the two fields carry no `Ref`, so nothing about them is ever
  submitted (see AP-3).
- **Does not appear on the child's `new` page.** In new-page/create context, `parentType` and
  `parentId` are carried as **hidden inputs** (`selectedParentTypeRef`/`selectedParentIdRef`,
  defaulting from the `initialParentType`/`initialParentId` query-param props) — there is no
  visible parent-context display shown to the user while creating a child; the label only becomes
  visible once the row exists and its edit page is opened.

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

- Enum fields are displayed as their string label (e.g. `"In Progress"` not `2`), but the mechanism
  now differs by enum kind (`code_generator/generators.py`'s `form_view_context()`,
  `enum_integer_flds`/`enum_native_flds`): a legacy **integer**-backed enum (`x-enum-labels`) maps
  the stored index into a label array at render time as described; a **nativeEnum** (Prisma string
  enum, increasingly the default for new/promoted fields — see
  `docs/knowledge/schema-yaml-configuration.md`) stores the label string itself and resolves it
  through a translation namespace hook instead of an index lookup. Don't assume every enum field on
  a bridge parent's detail page is still integer-indexed.
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
| AP-1: Parent label source | `labelField` → `x-display.table`'s `primary: true` column → name/title/label/id |
| AP-2: Child CRUD location | Parent edit page only; child form = separate page with parent context |
| AP-3: Read-only enforcement | `parent_type`/`parent_label` are computed-only virtual fields with no writable input at all — structural exclusion, not a submit-time reject |
| Extension 1: `x-readonly` | Field-level property; generator renders non-editable display field |
| Extension 2: Parent context fields | Two read-only `AppFieldText` fields, edit page only; new page uses invisible hidden inputs instead |
| Child list rendering | DataGrid in parent `FormUpsert` + `FormView`; columns from `x-display.table` |
| Parent detail enum display | String label; via index lookup for legacy integer enums, via translation namespace for nativeEnum |
| Generic "+" removal | Removed; child creation only via parent-context entry points |
