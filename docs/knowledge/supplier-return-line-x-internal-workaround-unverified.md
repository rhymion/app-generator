# `supplier_return_line.organization_id`'s x-internal workaround: stated reason unverified, could not be reproduced

## Symptom (as filed in the schema annotation)

The inventory-app consumer schema declares `supplier_return_line.
organization_id` with `x-internal: true` at the **field** level (not the
entity level `x-internal` is actually meant for — see
`schema-yaml-configuration.md` §4.5, and `validate.py`'s field-level
`x-internal` rejection). The schema comment next to it gives a reason:

> a second relation config on this entity triggered a FormUpsert.tsx
> template gap (the generated column function's 2nd
> `EntityAutocompleteCellConfig` parameter was left unwired at the call
> site) — excluding it from UI forms/list columns via `x-internal`
> sidesteps that gap.

## Discovery path

While fixing the fact that `x-internal` is entity-level-only and silently
does nothing when written on a field (fail-open,
`code_generator/validate.py`), documenting the FormUpsert.tsx gap this
field-level `x-internal` was working around required first verifying the
stated reason against actual generator behavior, rather than copying it
as-is — a workaround's own justification comment is not itself proof the
workaround was necessary.

## What was checked

1. **The "2nd relation config" claim does not survive comparison with a
   sibling entity already in production.** `goods_receipt_line` (same
   consumer schema) declares 9 `x-relationship` FK fields
   (`goods_receipt_id`, `purchase_order_line_id`, `asn_line_id`, `item_id`,
   `unit_of_measure_id`, `destination_bin_id`, `inventory_id`,
   `parent_goods_receipt_line_id`, `organization_id`) and works without any
   `x-internal` workaround. "The 2nd relation config breaks it" cannot be
   true as literally stated.

2. **`supplier_return_line` itself already has more than "2" relation
   configs before `organization_id` is even counted**: `supplier_return_id`
   (structural parent FK), `item_id`, `unit_of_measure_id` — 3
   `x-relationship` fields already merged and working. Adding
   `organization_id` as a proper `x-relationship` would make it the 4th
   total / 3rd non-parent relation, not literally "the 2nd."

3. **Direct code reading** of `code_generator/generators.py`:
   - `column_def_context()` builds the generated `use{X}Columns(editable,
     ...)` function's optional `EntityAutocompleteCellConfig` parameters by
     iterating the child entity's own merged properties, skipping only the
     literal `{parent_model}_id` key.
   - The call site (child-grid setup in the FormUpsert context builder)
     builds its argument list via `get_parent_relationships(child_def)`
     filtered by `get_parent_fk_props(child_def, model)` — a **different**,
     target-based way of identifying the structural parent FK (matches by
     `x-relationship.target == model`, not by field-name pattern).
   - For `supplier_return_line`'s actual field names, both methods agree on
     which field is the structural parent FK (`supplier_return_id`, target
     `supplier_return`) and which are additional lookups (`item_id`,
     `unit_of_measure_id`, and — hypothetically — `organization_id`), so no
     parameter/argument mismatch should occur from this code path.

4. **Empirical reproduction** (a scratch fixture entity pair, run through
   this repo's own `build_user_schema.py` → `generate.py` pipeline in an
   isolated location, never committed and discarded after this
   investigation, since the code path in question is pure generator logic
   with no consumer-specific dependency): a throwaway parent/child pair
   reproducing `supplier_return`'s exact shape — the child has **no
   `x-generate`** (raw, inline-DataGrid-embedded-only, same as
   `supplier_return_line`), a structural parent FK, plus **three**
   non-parent `x-relationship` fields named `item_id`,
   `unit_of_measure_id`, and **`organization_id`** (targeting an
   `organization` model — the literal names from the real schema, not
   placeholders). Generated output:
   ```
   // column_def.tsx
   export function useLinesColumns(editable: boolean = false, itemIdConfig?: EntityAutocompleteCellConfig, unitOfMeasureIdConfig?: EntityAutocompleteCellConfig, organizationIdConfig?: EntityAutocompleteCellConfig): GridColDef[] { ... }

   // FormUpsert.tsx
   const itemIdConfig = useMemo<EntityAutocompleteCellConfig>(() => ({ ... }));
   const unitOfMeasureIdConfig = useMemo<EntityAutocompleteCellConfig>(() => ({ ... }));
   const organizationIdConfig = useMemo<EntityAutocompleteCellConfig>(() => ({ ... }));
   const linesColumns = useLinesColumns(true, itemIdConfig, unitOfMeasureIdConfig, organizationIdConfig);
   ```
   All three parameters are declared, and the call site wires all three in
   the same order the function declares them. **No "2nd parameter left
   unwired" gap reproduces.**

## Conclusion

The schema annotation's stated reason for `supplier_return_line.
organization_id`'s `x-internal: true` workaround could not be reproduced,
by direct code reading or by empirical fixture reproduction against the
exact real field/entity names. A workaround's own justification comment
was written into the schema without being verified against actual
generator behavior — a fabricated or mistaken defect claim standing in for
a documented, reproduced one.

**This does not itself resolve how `organization_id` should be declared**
— that is a separate, ongoing UI-exposure design question (hide the column
entirely vs. give it a proper `x-relationship`). What this investigation
does establish: if that design question concludes `organization_id` should
become a proper `x-relationship`, there is no known FormUpsert.tsx template
gap blocking that change based on the checks above — that finding should
feed into the design decision rather than assuming the workaround must
stay.

**Open item, not fully closed**: this investigation covered the specific
shape actually in production (no-`x-generate` DataGrid child, 3 non-parent
relations, all targeting distinct entities). It does not prove no gap
exists for every possible shape (e.g., two relations targeting the *same*
entity, or a much larger relation count on a no-`x-generate` child) — those
remain unverified, not confirmed-safe.
