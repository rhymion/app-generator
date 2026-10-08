# `x-autocomplete-context` — narrow an FK picker by other fields of the same form

A many-to-one FK field normally offers every candidate the caller may read. When the right candidates
depend on another field of the same record (a ticket's assignee must be a party already on the ticket's
policy), declare that field with `x-autocomplete-context`. The generated form then sends the current
value of that field to the target entity's `autocomplete_filter.ts`, which decides how to narrow the
candidates.

The key only chooses *which values are sent*. The narrowing itself is hand-written code in the target's
`lib/{target}/autocomplete_filter.ts`; without such code the key changes the request but not the result.

## Declaring it

```yaml
ticket:
  properties:
    policy_id:
      type: string
      x-relationship: {type: many-to-one, target: policy, labelField: name}
    assignee_id:
      type: string
      x-relationship: {type: many-to-one, target: party, labelField: name}
      x-autocomplete-context: [policy_id]   # the key: a list of field names of `ticket`
```

- It sits on the FK property, beside `x-relationship` (not inside it).
- The value is a list of strings. Each string must be a property of the entity that declares the key (the
  entity whose form holds the picker), not of the relationship target.

## What changes in the generated output

Only the FK property that carries the key is affected. Every other field, and every entity that does not
declare the key, generates the same code as before.

| Path | Effect |
|------|--------|
| Create and edit form (`components/{entity}/FormUpsert.tsx`) | The picker's search call becomes `search{Target}Options(query, includeIds, 50, { callerEntity: '{entity}', formValues: { policy_id: policyId } })`. The search action is memoized on the context fields' current values, so changing one re-runs it. |
| Create and edit form, empty picker | The picker's initial candidate list is not the list fetched when the page loaded. The form keeps it in state, seeded from that fetch, and replaces it by calling the same search action with an empty query on mount and whenever a context value changes. A narrowed field therefore never offers the unfiltered default candidates before the user types, and a candidate outside the context cannot be picked from the default list. |
| Split action (`components/{entity}/SplitActionSection.tsx`) | Applies to an entity with `x-splittable` and a `quantityField`, when a field named in `perPartRequired` carries the key. `SplitActionSection` receives each context field as a prop, the detail view (`FormView.tsx`) passes the record's stored value for it, and the per-part picker searches with the same `callerEntity` and `formValues`. Without the key the picker searches with the query only. |

The REST route `GET /api/{target}/options` accepts a `context` parameter for every entity, whether or not
any schema declares the key (see [relation-picker-rest-route.md](relation-picker-rest-route.md)). The key
is not read by the route and changes nothing in it. The generated mobile app does not send `context`.

The create and edit pages (`page_new`, `page_edit`) still fetch the first candidate list with
`{ callerEntity }` only; the form then replaces it as described above.

The key is not read for FK cells of an embedded child DataGrid, which build their own search call.

## Relationship to `autocomplete_filter.ts`

`lib/{target}/autocomplete_filter.ts` is a file generated once (never overwritten) for each entity. Its
`filterAutocompleteOptions(context)` returns a `where` fragment that `search{Target}Options()` ANDs
after the authorization scope and the text match, so it can only narrow:

```ts
export type AutocompleteFilterContext = {
  callerEntity?: string;               // the entity whose form hosts the picker
  formValues?: Record<string, unknown>; // the values named by x-autocomplete-context
};
```

`formValues` is client input and untrusted; use it only to narrow. A target filter reads the keys it
expects, for example:

```ts
export function filterAutocompleteOptions(context: AutocompleteFilterContext) {
  if (context.callerEntity !== 'ticket') return {};
  const policyId = context.formValues?.policy_id;
  if (typeof policyId !== 'string') return {};
  // Return a Prisma `where` fragment on the target model that keeps only the
  // candidates that belong with this policy.
  return { /* ... */ };
}
```

The stub returns `{}`. The same function serves the web picker and the REST route, so the narrowing is
identical on both.

## Validation

`validate.py` checks the key on every FK property whose `x-relationship` type is `many-to-one`,
`one-to-one` or `one-to-one_bridge`. A failure stops generation with
`Schema validation failed — N error(s) must be fixed before generation can proceed:` and one line per
problem:

| Declared value | Result |
|----------------|--------|
| not a list, or a list with a non-string item (`policy_id`, `{a: 1}`, `[1]`) | `Definition 'ticket', property 'assignee_id': x-autocomplete-context must be a list of field name strings.` |
| a name that is not a property of the declaring entity | `Definition 'ticket', property 'assignee_id': x-autocomplete-context references field 'nope', which is not a property of 'ticket'.  formValues are pulled from this entity's own form state, not from the relationship target 'party'.` One line for each unknown name. |

Not checked, and accepted without error:

- the key on a property that has no `x-relationship` (it is ignored);
- an empty list `[]` (same output as no key);
- the FK field naming itself in its own list.

## When the key is absent

The picker searches with `search{Target}Options(query, includeIds)`: no `formValues`, and the form keeps
its initial list from the page load. `autocomplete_filter.ts` still runs, with an empty context.

## Checking the output

With the example schema (`policy_id` and `assignee_id` above), generating once with the key and once
without changes one file, `components/ticket/FormUpsert.tsx`: the `useEffect` import, the
`[assigneeIdInitialOptions, setAssigneeIdInitialOptions] = useState(...)` line in place of a `useMemo`, the
four-argument `searchPartyOptions` call, and the `useEffect` that calls `assigneeIdSearchAction('', [])`.
Adding `x-splittable: {quantityField: quantity, perPartRequired: [assignee_id]}` to `ticket` also changes
`FormView.tsx` and `SplitActionSection.tsx` as in the table above.

## Tests

- `code_generator/tests/test_validation_message_reason_and_context_filter.py` (class
  `TestContextFilteredAutocompleteInitialOptions`): a narrowed field refetches through its own search
  action on mount and when the context changes, still seeds from the page-load fetch, sets
  `uses_use_effect` only when a context field exists, and leaves an unfiltered relation unchanged.
- The validation rejections above have no dedicated test.

## See also

- [relation-picker-rest-route.md](relation-picker-rest-route.md): the REST picker route and its `context` parameter.
- [code-generation-custom-extensions.md](code-generation-custom-extensions.md) and [architecture-overview.md](architecture-overview.md): the write-once extension stubs, including `autocomplete_filter.ts`.
- [same-entity-validation-socket.md](same-entity-validation-socket.md): a filter that reads `formValues` for a self-referencing relation.
- [schema-yaml-configuration.md](schema-yaml-configuration.md): the other field-level keys beside `x-relationship`.
