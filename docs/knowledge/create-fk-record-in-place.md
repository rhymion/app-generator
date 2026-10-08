# Create the referenced record in place (`x-create-inline`)

A many-to-one foreign-key field normally offers only the existing records of its target. With
`x-create-inline: true` on the field, its autocomplete also offers **Create new**: the target
entity's own generated form opens in a dialog, and once the record is saved it is selected in the
field. The user does not leave the form to create the target on its own page and come back.

This covers a single foreign-key field on a generated create or edit form. Foreign-key cells of an
embedded child DataGrid, many-to-many fields and the independent-children "add existing" list do not
offer it.

The generated Expo mobile app offers the same control in its native picker; see
`mobile-app.md` ("Create the referenced record in place").

## Declaring it

```yaml
inline_note:
  fields:
    inline_topic_id:
      x-relationship:
        labelField: name
      x-create-inline: true      # the key; true or false, absent means false
```

The key sits on the field, beside `x-relationship`; it is not a setting inside `x-relationship`.

## Which targets and fields are accepted

Every other shape is a schema validation error that names the entity and field (fail closed); the
key is never silently ignored.

| Case | Why it is rejected |
|---|---|
| the field is not many-to-one (a one-to-one selector, a one-to-one bridge, a direct attachment, or no `x-relationship` at all) | the dialog creates the record a plain foreign key points at |
| the target has `x-approval` | creating it starts an approval flow, so the new record could not be used at once |
| the target has `x-payment` | saving it redirects to a hosted checkout page, which cannot happen inside a dialog |
| the target is an internal or bridge entity (no generated pages) or has `x-generate.new: false` | there is no create form to open |
| the target has `x-self-only` | the record belongs to its creator, so creating it from another entity's form is ambiguous |
| the target is `x-internal` | it has no generated form |
| the target itself declares `x-create-inline` on any field | nesting depth is 1: the dialog shows the target's form, which must not open a further dialog |
| the value is not `true` or `false` | |

The user's own permission is not a schema matter; see below.

## What is generated

For the declaring entity (`inline_note`):

- `components/inline_note/FormUpsert.tsx` passes `onCreateNew` and `createdNotice` to the field's
  `AppFieldRelation` and renders the target's dialog **beside** the form, never inside it. The dialog
  holds its own `<form>`, and a React submit event bubbles through the dialog's portal to a parent
  form's `onSubmit`.
- The control is shown only after `can<Target>BeCreatedInline()` says the user can open the target's
  create form; until then, and for a user who cannot, only the existing records are offered. This is a
  hint: the save action is the authority on whether a record is created.
- The created record is selected through its own option. Its label is read back through the field's
  own search action (which returns the requested ids verbatim), so a record outside the initial
  options and the current search results still shows its label.

For the target entity (`inline_topic`), generated only when some field declares the key:

- `lib/inline_topic/inline_create.ts` (server actions): `can<Target>BeCreatedInline()` runs the
  access check the `/<target>/new` page makes (`get<Target>NewPageAccessCheck()`), because the
  dialog shows that form; `get<Target>InlineCreateInit()` loads what `/<target>/new` loads for its
  form (the same access check and the options of the form's own selection fields), on the server,
  so the permission-denied markers become plain booleans before they cross to the client.
- `components/inline_topic/InlineCreateDialog.tsx`: loads that on every opening and shows the
  target's own `FormUpsert`. A required foreign key of the target whose own target the user cannot
  read shows the same explanation as the target's `/new` page instead of a form that could never save.
- `components/inline_topic/FormUpsert.tsx` follows the `InlineCreate` context
  (`components/_standard/InlineCreate.tsx`) while it is in the dialog: it asks the action for the new
  id, reports it, cancels without navigating, and does not offer "Save and continue editing".
- `upsert<Target>` in `lib/inline_topic/actions.ts` gains a **return-id mode**: with `__return_id=1`
  it returns `{ ok: true, id }` instead of redirecting. The mode is read first, and a request that also
  carries an `id` (an update) is refused before anything runs. The permission check, the form-data
  validation and the `add<Target>()` call, with its service validation and organisation check, all run
  above the return, exactly as for the target's own form; a failure returns an `ActionFailure` as usual.
  Entities no field offers for inline creation get none of this.

## Permissions, validation and organisations

Nothing is duplicated for the dialog. It saves through the target's own `upsert<Target>` action, so
the target's create permission, its validation (client and service), its required fields and its
organisation scoping apply as they do on its own form. A topic for an organisation the user does not
belong to is refused with the same not-found failure as on the target's own form, even if the request
is altered (`org_id_client_writable` check in `add<Target>()`). The organisation options in the dialog
are the user's own memberships.

## When the parent form is not saved

The dialog creates the target record immediately, as its own committed write. If the form is then
cancelled or never saved, the record stays. After a creation the field shows a notice
(`Common.createdInlineNotice`) saying so, and it stays even if the user then picks another record.
The write is not atomic with the parent save.

A created record is an ordinary row; nothing marks it as created in a dialog. To find targets that no
record references, query the foreign key, for example:

```sql
SELECT t.id, t.name, t.created_at
FROM inline_topic t
LEFT JOIN inline_note n ON n.inline_topic_id = t.id
WHERE n.id IS NULL;
```

## Tests

- `code_generator/tests/test_x_create_inline_validation.py` — each accepted and rejected shape.
- `code_generator/tests/test_x_create_inline_generation.py` (fixture `fixtures/create_inline_gate`) —
  what the declaring form, the target and an unrelated entity get; the dialog beside the form; the
  return-id mode after the permission and validation path, creating only.
- `components/ui/forms/AppFieldRelation.test.tsx`, `components/_standard/InlineCreate.test.tsx`,
  `components/_standard/FormWithChildGrid.test.tsx` — the control, the context, the dialog back control.
- The child-DataGrid end-to-end gate (`npm run test:child-datagrid-e2e-gate`, fixture entities
  `inline_note` and `inline_topic`): `inline_create.cy.ts` (desktop) and `inline_create_mobile.cy.ts`
  (phone width) share `inline_create_flows.ts` — create in the dialog and select it, cancel, keep the
  created record when the form is left, a required-field error in the dialog, only the user's
  organisations offered, a topic for another organisation refused with the request altered, and no
  control for a user who may not create.
