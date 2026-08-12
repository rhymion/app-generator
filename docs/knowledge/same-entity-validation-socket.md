# Constraining a self-referential m2m link to matching sibling records: hand-written socket, not a schema mechanism (cmd_652)

## History

cmd_646 first attempted this as a declarative `sameEntityField` generator
mechanism (one `x-relationships.<rel>.sameEntityField: <field>` line in
`json_schema.yaml` driving three generated call sites). On review (cmd_652)
that design was rejected: the *business condition* itself — "same-entity_name
is what this relation happens to require, but a future relation could need a
different condition entirely" — must never be absorbed into the schema or a
`*.jinja2` template. The generator's job stops at providing a **socket**: an
unconditional call site plus enough exposed data for a hand-written function
to make the decision. The decision itself — which field(s), what "matches"
means, what error to throw — is hand-written, in a file the generator writes
once and never overwrites again, following the same convention as
`lib/{entity}/autocomplete_filter.ts` (cmd_377/379).

This also reaffirms an earlier, independent decision on the exact same
tension: cmd_636 already rejected special-casing `approval_flow`'s
self-referential test-fixture generation in the generator (it had briefly
been done in cmd_630/83dd8e2e, then reverted), on the same principle —
"don't force the generator to accommodate one entity's business rule; put it
in a hand-written spec instead." cmd_646 reintroduced generator-side
special-casing for this same test-fixture problem (`match_self_entity`,
threaded from the very `sameEntityField` schema key this doc replaces) —
which cmd_652 also reverts, back to the cmd_636 baseline. See "Test
fixtures: reverted to the cmd_636 baseline" below.

## The pattern

Two independent generator-side changes make the socket possible; the
business content lives entirely in hand-written files:

### 1. Unconditional save-time validation hook

Every entity gets a write-once stub, `lib/{entity}/service_validation_custom.ts`
(`code_generator/templates/service_validation_custom_stub.ts.jinja2`,
written via `generate.py`'s `_write_stub()` — same skip-if-exists,
self-healing-if-stale mechanism as `autocomplete_filter.ts`/`list_filter.ts`).
The generated `lib/{entity}/service_validation.ts` (`service_validation.ts.jinja2`)
unconditionally imports and calls it:

```ts
import { validateCustomRules } from '@/lib/{{ model }}/service_validation_custom';
// ...inside validateSchemaRules(), after the generated required-field and
// one-to-one checks:
await validateCustomRules(tx, data, currentId);
```

No schema flag decides whether this call happens — it happens for every
entity, every time. The default stub is a no-op; nothing changes for
entities that don't need custom validation.

`data` includes every connect-style (m2m / optional-FK-list) child's
selected id array under its property name — `build_context.py`'s
`validation_data_obj` now exposes this unconditionally for every such child
(not gated by any schema flag), so a hand-written hook can read any child
selection it needs without the generator having to know in advance which
one matters.

### 2. Unconditional live-value forwarding for self-referential searches

`code_generator/generators.py`'s `form_upsert_context()` already had a
`live_state_var_by_field` lookup (current `useState` variable per
controlled field). For a self-referential (`is_self`) child's candidate
search, every field with a live variable is now spliced onto the
DB-snapshot `src` object unconditionally:

```tsx
formValues: { ...(src as unknown as Record<string, unknown>), <every live field>: <its live var> }
```

The generator does not pick which field matters — it makes every live value
visible and lets `lib/{entity}/autocomplete_filter.ts`'s
`filterAutocompleteOptions()` read whichever one its own business rule
needs from `context.formValues`.

## Applying this to `approval_flow`'s preceded_by/followed_by (the worked example)

All hand-written, in files the generator only writes once:

- `lib/approval_flow/autocomplete_filter.ts` — `isCrossEntityRef(entityName,
  relatedEntityName)` (the atomic comparison) and `filterAutocompleteOptions()`
  (client-side WHERE-equality narrowing by `entity_name`, best-effort: empty
  `entity_name` shows everything — Option B, cmd_646 D1, unchanged by this
  correction).
- `lib/approval_flow/service_validation_custom.ts` — `validateCustomRules()`
  calls a local `validateSameEntityRefs()` helper for both `preceded_by` and
  `followed_by`, fetching the linked rows' own `entity_name` and calling
  `isCrossEntityRef()` per row (the authoritative, save-time check — same
  predicate as the filter, applied as a row check instead of a query
  predicate, since there is no per-row value available yet at
  query-construction time).

To apply the same pattern to a new entity's self-referential relation: open
its `lib/{entity}/autocomplete_filter.ts` and `service_validation_custom.ts`
stubs (both hand-editable, GENERATED ONCE) and write the equivalent pair of
functions — no `json_schema.yaml` or `*.jinja2` change is needed or
appropriate.

## Test fixtures: reverted to the cmd_636 baseline

`code_generator/generators_test.py`'s `_get_dep_populate_fields()` no longer
takes a `match_self_entity` parameter. Self-referential dependency records
(`is_self_ref=True`) again always pick the SECOND `x-entity-select` option,
diverging from the primary test record's value — this is the general,
schema-flag-free P2002-avoidance default, unconditionally correct for any
self-ref entity regardless of what hand-written validation (if any) it has.

Consequence: the generated `approval_flow.cy.ts` 2.2/3.1 "Add Preceded
By"/"Add Followed By" steps can no longer assume the typed dep
(`deps.precededBy`/`deps.followedBy`) is actually selectable — a
hand-written filter like `autocomplete_filter.ts`'s may narrow it out of
the popper entirely (diverging `entity_name` in this case). Those steps use
`cy.get('.MuiAutocomplete-popper li').first().click()` (select whatever the
filter surfaces), not an exact-name match — see the `cmd_652` comment in
`code_generator/templates/test_spec.cy.ts.jinja2`'s `dep_var_name` branch.
Real, business-meaningful coverage of the filtering/linking/rejection
behavior lives entirely in the hand-written
`cypress/e2e/approval_flow_same_entity_autocomplete_filter.cy.ts` (cmd_613,
extended cmd_646) — that spec seeds its own same/different-`entity_name`
records directly via the API rather than relying on generated dependency
fixtures.

## Reference test

`cypress/e2e/approval_flow_same_entity_autocomplete_filter.cy.ts` — one UI
test proving same-entity_name candidates show and different-entity_name
candidates are hidden, a label-consistency regression test, one UI test
proving a save is rejected after changing `entity_name` out from under an
already-added link, and two direct-API tests (POST/PUT a cross-entity id
directly into `precededBy_ids`/`followedBy_ids`, assert a 4xx response with
the guard's error message). Use it as the template when adding a
same-entity constraint to a new entity.
