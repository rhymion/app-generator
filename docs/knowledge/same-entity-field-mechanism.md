# `sameEntityField`: constraining a self-referential m2m link to matching sibling records (cmd_646)

## Problem it solves

Some entities have a self-referential many-to-many relationship (e.g.
`approval_flow.preceded_by` / `approval_flow.followed_by`, both linking
`approval_flow` to itself) where a *sibling field's value* must match between
the two linked rows. `approval_flow` is scoped per `entity_name` (the entity
the flow applies to, e.g. `'user'`, `'purchase'`), and a chain link
(`preceded_by`/`followed_by`) must only ever point at another `approval_flow`
row with the *same* `entity_name` — linking a `'user'` flow to a `'purchase'`
flow is meaningless and must never be selectable-and-saved.

`sameEntityField` is a generator mechanism that expresses this constraint
declaratively — one line in `json_schema.yaml` — and gets three generated
call sites (form-state filtering, save-time validation, and test fixtures)
in sync automatically, with no hand-written entity-specific code beyond a
single small stub function.

## Declaring it

On the self-referential `x-relationships` entry, add `sameEntityField:
<field-name>`:

```yaml
# approval_flow's json_schema.yaml entry (abridged)
x-relationships:
  preceded_by:
    type: many-to-many
    target: approval_flow
    sameEntityField: entity_name
  followed_by:
    type: many-to-many
    target: approval_flow
    sameEntityField: entity_name
```

`code_generator/validate.py` fail-closes on a misconfigured declaration at
`generate-code` time:
- `sameEntityField` must be a string
- the relationship must be self-referential (`target` === the entity
  defining it)
- the named field must actually exist as a property on the entity

A misspelled or nonsensical declaration errors immediately instead of
silently having no effect.

## The three generated locations

One declaration drives three independent code-generation paths. The two
live-behavior paths (form-state filtering and save-time validation) are kept
from drifting apart by routing both through one hand-written shared
predicate.

### 1. Live form-state filtering (`code_generator/generators.py`)

`form_upsert_context()` has a `live_state_var_by_field` lookup: for common
field types (`entity_select`, enum, boolean, date_time, custom_upsert, FK
relation properties) it knows the safe `useState` variable name that holds
the field's *current on-screen value*. When a self-ref child relationship
declares `sameEntityField`, and the declared field resolves in this lookup,
the generated `formValues` passed to the Autocomplete filter becomes:

```tsx
formValues: { ...(src as unknown as Record<string, unknown>), entity_name: entityName }
```

— i.e. the DB-loaded `src` spread, with just the declared field overridden
by its live state variable. This means the picker filters against what the
user currently has selected in the form (e.g. after changing "Applies To"),
not the last-saved value. If `sameEntityField` is unset, or the declared
field isn't a recognized live-state type, `formValues: src` is used
unchanged (no behavior change — this path is additive).

### 2. Save-time validation guard

Three files cooperate to generate a save-time guard that rejects a
cross-entity link regardless of how the save request arrives (UI form,
direct REST call, or server action):

- `code_generator/validation_context.py` computes a `same_entity_checks`
  list: every self-ref, `use_connect` child relationship that declares
  `sameEntityField`.
- `code_generator/build_context.py` adds a `{property_name}: {child_var}Ids,`
  entry to `validation_data_obj` for each such child, so the generated
  validator can read the submitted id list without changing its function
  signature.
- `code_generator/templates/service_validation.ts.jinja2` conditionally
  generates a `validateSameEntityRefs()` function and wires it into both
  `validateOnAdd()` and `validateOnUpdate()`. It looks up each submitted
  linked id's own `entity_name`, and rejects the request (thrown `Error`,
  surfaced as a save failure) if any linked row's value differs from the
  record's own.

This is the enforcement layer: even if the UI ever shows a cross-entity
option (by design — see "Why the picker still shows everything" below), the
row can never actually be saved with a cross-entity link.

### 3. The shared predicate (`lib/{entity}/autocomplete_filter.ts`)

This file is GENERATED ONCE (hand-editable stub, not regenerated once it
exists). It gets a new function:

```ts
export function isCrossEntityRef(entityName: string, relatedEntityName: string): boolean {
  return entityName !== relatedEntityName;
}
```

`service_validation.ts.jinja2`'s generated `validateSameEntityRefs()`
imports and calls this same function that the Autocomplete filter uses
internally — the UI filter and the save-time guard answer "is this a
cross-entity reference?" through one function, so they cannot silently
diverge from each other over time.

### Test fixtures (`code_generator/generators_test.py`)

`_get_dep_populate_fields()` takes a new `match_self_entity` argument. The
generic self-referential-dependency pattern (cmd_592) deliberately seeds a
*mismatched* decoy sibling row, to prove a spec doesn't accidentally match
the wrong record by substring. That's the wrong fixture shape once a save-time
`sameEntityField` guard exists — a generated spec would trip its own new
guard. When `sameEntityField` is declared, the self-ref dependency fixture
instead seeds a row that **matches** on the declared field, so ordinary
generated specs (create/edit flows) keep passing under the new guard.

## Why the picker still shows everything (Option B, not Option A)

An alternative design (disable the picker entirely until the declaring field
has a value, and hide cross-entity options from it) was considered and
rejected: it would require a new `disabled` prop on the generic
`EditableListWrapper` component plus a new conditional-rendering concept in
the generator, for a behavior no other entity needs yet — i.e. it would
introduce new generic machinery rather than reuse existing generated
machinery, which cuts against the point of a generator-templated codebase.
`sameEntityField` instead reuses two things that already exist (live
`formValues` overrides, save-time validation) and adds no new UI concept.
The tradeoff: the picker can show a cross-entity option, but selecting and
saving it is always rejected server-side — "shown but never savable" rather
than "never shown".

## Applying this to a new entity

Two steps:

1. In `json_schema.yaml`, add `sameEntityField: <field>` to the
   self-referential `x-relationships` entry that needs the constraint.
2. Open the entity's `lib/{entity}/autocomplete_filter.ts` (GENERATED ONCE
   stub) and add an `isCrossEntityRef()` function following the pattern
   above — copy `lib/approval_flow/autocomplete_filter.ts`'s version and
   adjust the compared field if it isn't `entity_name`.

That's it — `generate-code` produces the live-filtering `formValues`
override, the `validateSameEntityRefs()` guard, and the matching test
fixture automatically from the declaration; no further Python or template
changes are needed for a new entity using this same shape.

## Reference test

`cypress/e2e/approval_flow_same_entity_autocomplete_filter.cy.ts` is the
worked example: one UI test (change `entity_name` after adding a same-entity
link, attempt to save, assert the save is rejected and the record's
`entity_name` is unchanged) and two direct-API tests (POST/PUT a
cross-entity id directly into `precededBy_ids`/`followedBy_ids`, assert a
4xx response with the guard's error message). Use it as the template when
adding a same-entity-field constraint to a new entity.
