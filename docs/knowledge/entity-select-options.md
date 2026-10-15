# `x-entity-select` options and their labels

A string field declared with `x-entity-select` holds the name of one of the schema's entities
(`permission.name`, `approval_flow.entity_name`). Every such field offers the same option set, and every
screen shows an option by its dictionary word while the stored value stays the entity name.

## Which entities are offered

`_get_entity_options` (`code_generator/build_context.py`) builds the set: every entity `extract_entities` returns
(the entities with generated pages or routes, each guarded by its own permission), in schema order, followed by
`audit_log`.

`audit_log` is the one system table a Permission row can name although it is not a schema definition:
`getModelPermissions` (`lib/authz.ts`) answers for it by name. It is not in the schema's definitions, so
`extract_entities` never returned it, and it could not be chosen.

Entities without generated pages (`approval_request`, `comment`, `attachment`, `dashboard_widget`, child-only
entities) are not offered on purpose: they are not permission or approval targets. Internal-only entities (every core
`x-generate` flag `false`) and `x-internal` entities are not offered either. A Permission row that names an entity
the schema does not define (for example a stale row left from another schema) shows its stored name as is.

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
- Generated specs find a list row by the dictionary word (`EntityLabel` of `messages/en.json`), not by the entity name: the list
  lookups use the word, and the delete tests translate the stored `name` of a populated record with a `nameLabels` map.

A child DataGrid column that holds an entity name keeps showing the stored name; only the screens above use the dictionary.

## Tests

- `code_generator/tests/test_entity_select_options.py`: the option set, the `EntityLabel` keys in every locale, the Web
  view / edit / list output.
- `code_generator/tests/test_mobile_entities.py`: the mobile spec keys, the shipped messages, the chips and texts.
- `cypress/e2e/entity_select_dictionary.cy.ts`: the Web select, list and detail pages.
- `mobile/e2e/entity-select.spec.ts`: the mobile chips, detail text and language switch.
