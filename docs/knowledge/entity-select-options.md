# `x-entity-select` options and their labels

A string field declared with `x-entity-select` holds the name of one of the schema's entities
(`permission.name`, `approval_flow.entity_name`). Every such field offers the same option set, and every
screen shows an option by its dictionary word while the stored value stays the entity name.

## Which entities are offered

`_get_entity_options` (`code_generator/build_context.py`) builds the set. One rule decides membership:
**an entity is offered when the authorization layer can be asked about it by name.** Permission rows are keyed by
the entity's view name (`requirePermission` / `getModelPermissions` in `lib/authz.ts`), so the set is the union of:

| Source | Why it belongs |
|---|---|
| `extract_entities` | The entity has generated pages or routes, each guarded by its own permission. |
| `seed_entities_context` (`seed_entity_names`) | The entity owns a permission grant: an independent entity with an `id`, including entities without `x-generate` such as `approval_request`, `comment` and `attachment`, and child-only entities. |
| `audit_log` | The system table `getModelPermissions` answers for by name. It is not a schema definition, so neither source above contains it. |

Not offered:

- x-bridge junction tables (no permission of their own).
- Internal-only entities whose core `x-generate` flags (`list`, `view`, `new`, `edit`, `delete`, `api`) are all `false`
  (`approvable`, `attachable`, `commentable`, `notification`): no page, route or grant exists for them.
- The `*_input` helper definitions.

The order is: generated entities in schema order (generated tests pick the first and second option), then the
remaining permission targets alphabetically, then `audit_log`.

### What dropped an entity before

`extract_entities` alone decided the set, and it skips an entity when it is `x-internal`, has no `x-generate`
(a child-only entity or a system table: `approval_request`, `comment`, `attachment`, `dashboard_widget`, and
child entities such as `receiving_purchase_order_line`), or has every core flag `false`.
`audit_log` was never in the schema's definitions at all.

## How an option is displayed

Each option is `{value, label, key}`: `value` is the entity name (what is stored), `key` is the camelCase key in the
`EntityLabel` namespace, and `label` is the English title used as the fallback and by generated tests.

- `generators_i18n.py` writes an `EntityLabel` key for every option into every `messages/<locale>.json`
  (existing values are kept; a new key in a non-source locale carries the English text until it is translated).
- Web edit and detail screens build the options with `te('<key>')` (`useTranslations('EntityLabel')`).
- The Web list formats the column server-side, as it does for a native enum: `<field>Labels[item.<field>] ?? item.<field>`.
- The mobile spec carries `optionLabelKeys` beside `optionLabels`; `lib/messages.ts` ships the `EntityLabel` words of the
  offered entities, and the chips, list cells and detail text translate the key (`optionText` / `toDisplayText` /
  `toRecordDisplayText` take the `t` of `useMessages`). The English title is the fallback when a key is missing.
- Generated specs find a list row by the dictionary word (`EntityLabel` of `messages/en.json`), not by the entity name.

A child DataGrid column that holds an entity name keeps showing the stored name; only the screens above use the dictionary.

## Tests

- `code_generator/tests/test_entity_select_options.py`: the option set, the `EntityLabel` keys in every locale, the Web
  view / edit / list output.
- `code_generator/tests/test_mobile_entities.py`: the mobile spec keys, the shipped messages, the chips and texts.
- `cypress/e2e/entity_select_dictionary.cy.ts`: the Web select, list and detail pages.
- `mobile/e2e/entity-select.spec.ts`: the mobile chips, detail text and language switch.
