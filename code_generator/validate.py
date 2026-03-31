"""
validate.py — Pre-generation schema validation.

Called by generate() before any files are written.  Collects all problems and
reports them together so the user can fix everything in one pass rather than
encountering errors one by one.

Raises SchemaValidationError (a ValueError subclass) on failure so generate()
can catch it and print a clean message without a traceback.
"""
import re

_SNAKE_CASE = re.compile(r'^[a-z][a-z0-9_]*$')
_ID_SUFFIX  = re.compile(r'_id$')


class SchemaValidationError(ValueError):
    pass


def validate_schema(schema: dict) -> None:
    """Validate *schema* and raise SchemaValidationError listing all problems."""
    defs = schema.get('definitions', {})
    if not defs:
        # Schema uses a format without 'definitions' (e.g. OpenAPI components) —
        # nothing to validate at this level.
        return
    errors = []

    # -----------------------------------------------------------------------
    # 1. Entity / definition names must be lowercase snake_case
    # -----------------------------------------------------------------------
    for def_key in defs:
        if not _SNAKE_CASE.match(def_key):
            errors.append(
                f"Definition '{def_key}': name must be lowercase snake_case "
                f"(e.g. 'my_entity', not 'MyEntity' or 'myEntity').  "
                f"The generator's naming helpers split on '_' to produce TypeScript "
                f"identifiers; an uppercase start or camelCase input will produce "
                f"broken variable and type names."
            )

    # -----------------------------------------------------------------------
    # 2. Per-property relationship checks
    # -----------------------------------------------------------------------
    for def_key, defn in defs.items():
        if not _SNAKE_CASE.match(def_key):
            continue  # already reported; can't safely inspect properties

        props = defn.get('properties', {})
        for prop_name, prop_def in props.items():
            rel = prop_def.get('x-relationship', {})
            if not rel or rel.get('type') != 'many-to-one':
                continue

            target      = rel.get('target', '')
            label_field = rel.get('labelField')

            # 2a. FK field must end with _id
            if not _ID_SUFFIX.search(prop_name):
                errors.append(
                    f"Definition '{def_key}', property '{prop_name}': "
                    f"FK fields that carry x-relationship must end in '_id' "
                    f"(e.g. rename to '{prop_name}_id').  "
                    f"The generator strips the '_id' suffix to derive the Prisma "
                    f"relation object name used in include clauses, TypeScript types, "
                    f"and React component props."
                )

            # 2b. Relationship target must exist in definitions
            if target and target not in defs:
                errors.append(
                    f"Definition '{def_key}', property '{prop_name}': "
                    f"x-relationship target '{target}' is not defined in the schema.  "
                    f"Add a '{target}' definition or correct the target name."
                )
                continue  # can't check further without the target

            if not target:
                continue

            target_props = defs[target].get('properties', {})

            # 2c. If labelField is specified, it must exist on the target
            if label_field and label_field not in target_props:
                errors.append(
                    f"Definition '{def_key}', property '{prop_name}': "
                    f"labelField '{label_field}' does not exist on target '{target}'.  "
                    f"Available fields: {sorted(target_props.keys()) or '(none)'}."
                )

            # 2d. If no labelField, the target must have a 'name' field (fallback label)
            if not label_field and 'name' not in target_props:
                errors.append(
                    f"Definition '{def_key}', property '{prop_name}': "
                    f"relationship target '{target}' has no 'name' field and no "
                    f"labelField is set in x-relationship.  "
                    f"The generator falls back to '.name' in DataGrid columns and "
                    f"autocomplete displays; without it those will render empty.  "
                    f"Either add a 'name: {{type: string}}' field to '{target}' "
                    f"or set labelField to the correct display field."
                )

    # -----------------------------------------------------------------------
    # 3. Many-to-many x-relationships labelField checks
    # -----------------------------------------------------------------------
    for def_key, defn in defs.items():
        if not _SNAKE_CASE.match(def_key):
            continue
        x_rels = defn.get('x-relationships', {})
        for rel_prop, rel_info in x_rels.items():
            if not isinstance(rel_info, dict):
                continue
            if rel_info.get('type') != 'many-to-many':
                continue
            target      = rel_info.get('target', '')
            label_field = rel_info.get('labelField')
            if not target or target not in defs:
                continue
            target_props = defs[target].get('properties', {})
            if label_field and label_field not in target_props:
                errors.append(
                    f"Definition '{def_key}', x-relationships '{rel_prop}': "
                    f"labelField '{label_field}' does not exist on target '{target}'.  "
                    f"Available fields: {sorted(target_props.keys()) or '(none)'}."
                )
            elif not label_field and 'name' not in target_props:
                errors.append(
                    f"Definition '{def_key}', x-relationships '{rel_prop}': "
                    f"many-to-many target '{target}' has no 'name' field and no "
                    f"labelField is set.  Autocomplete labels in FormUpsert will be "
                    f"empty.  Add 'name' to '{target}' or set labelField."
                )

    # -----------------------------------------------------------------------
    # 4. x-generate entity-level constraints (chart fields, comment children)
    # -----------------------------------------------------------------------
    from generate_types import extract_entities
    try:
        entities = extract_entities(schema)
    except ValueError as exc:
        errors.append(str(exc))
        entities = []

    for entity in entities:
        model     = entity['model']
        model_def = defs.get(model, {})
        props     = model_def.get('properties', {})

        # 4a. Chart requires start/end fields to exist
        xdisplay  = model_def.get('x-display') or {}
        chart_cfg = xdisplay.get('chart') if isinstance(xdisplay, dict) else None
        if chart_cfg:
            start_f = chart_cfg.get('start_field', 'start_time')
            end_f   = chart_cfg.get('end_field', 'end_time')
            if start_f not in props:
                errors.append(
                    f"Entity '{model}': x-display.chart references start_field '{start_f}' "
                    f"but that field does not exist on the model.  "
                    f"Add '{start_f}: {{type: string, format: date-time}}' or set "
                    f"start_field to an existing field name."
                )
            if end_f not in props:
                errors.append(
                    f"Entity '{model}': x-display.chart references end_field '{end_f}' "
                    f"but that field does not exist on the model.  "
                    f"Add '{end_f}: {{type: string, format: date-time}}' or set "
                    f"end_field to an existing field name."
                )

        # 4b. Comment children must have a 'message' field
        for child in entity.get('children', []):
            if child.get('output_type') != 'comments':
                continue
            child_def   = defs.get(child['name'], {})
            child_props = child_def.get('properties', {})
            if 'message' not in child_props:
                errors.append(
                    f"Entity '{model}': child '{child['name']}' uses "
                    f"x-outputType: comments but has no 'message' field.  "
                    f"Add 'message: {{type: string, minLength: 1}}' to '{child['name']}'."
                )

    # -----------------------------------------------------------------------
    # Report
    # -----------------------------------------------------------------------
    if errors:
        bullet_list = '\n'.join(f"  • {e}" for e in errors)
        raise SchemaValidationError(
            f"Schema validation failed — {len(errors)} error(s) must be fixed "
            f"before generation can proceed:\n\n{bullet_list}\n"
        )
