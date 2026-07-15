"""
validate.py — Pre-generation schema validation.

Called by generate() before any files are written.  Collects all problems and
reports them together so the user can fix everything in one pass rather than
encountering errors one by one.

Raises SchemaValidationError (a ValueError subclass) on failure so generate()
can catch it and print a clean message without a traceback.
"""
import re
from pathlib import Path

from helpers.label_field import resolve_label_paths

_SNAKE_CASE = re.compile(r'^[a-z][a-z0-9_]*$')
_ID_SUFFIX  = re.compile(r'_id$')

# Columns that MUST be indexed (leftmost column of some @@index) when present
# on a model.  See docs/knowledge/prisma-schema-conventions.md.
_REQUIRED_INDEX_COLUMNS = ('creator_id', 'assignee_id', 'organization_id')


class SchemaValidationError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Prisma schema validation (separate from the YAML validation below)
# ---------------------------------------------------------------------------

_MODEL_HEAD = re.compile(r'^model\s+(\w+)\s*\{', re.MULTILINE)
_INDEX_DECL = re.compile(r'@@index\(\s*\[([^\]]+)\]')
_RELATION_DECL = re.compile(r'@relation\(([^)]*)\)')
_RELATION_FIELDS_ARG = re.compile(r'fields:\s*\[\s*([^\]]+)\]')
_UNIQUE_SCALAR = re.compile(r'^\s*(\w+)\s+\S.*?@unique\b', re.MULTILINE)


def _iter_model_blocks(text: str):
    """Yield (model_name, body_text) for each top-level `model X { ... }` block."""
    for m in _MODEL_HEAD.finditer(text):
        depth = 1
        j = m.end()
        while j < len(text) and depth > 0:
            ch = text[j]
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
            j += 1
        if depth != 0:
            raise SchemaValidationError(
                f"Prisma schema: unbalanced braces starting at offset {m.start()}"
            )
        # body = text between the opening '{' and the matching '}'
        yield m.group(1), text[m.end():j - 1]


def _model_has_column(body: str, col: str) -> bool:
    # Match `<col>` followed by whitespace and a type — i.e. a field declaration.
    return bool(re.search(rf'^\s*{re.escape(col)}\s+\S', body, re.MULTILINE))


def _leftmost_indexed_columns(body: str) -> set[str]:
    """Set of columns that appear as the LEFTMOST column in some @@index([...])."""
    out: set[str] = set()
    for decl in _INDEX_DECL.findall(body):
        first = decl.split(',', 1)[0].strip()
        if first:
            out.add(first)
    return out


def _relation_fk_columns(body: str) -> set[str]:
    """FK columns declared via `@relation(..., fields: [col, ...], ...)`.

    Auto-detects every FK on the model — not just the hardcoded hot columns in
    `_REQUIRED_INDEX_COLUMNS` — so bridge/relation columns added later (e.g.
    `commentable_id`, `approval_flow_id`) are checked without needing a manual
    list update.  Only the leftmost field of a composite FK is returned,
    matching the single-column-filtering convention used by
    `_leftmost_indexed_columns`.
    """
    cols: set[str] = set()
    for decl in _RELATION_DECL.findall(body):
        m = _RELATION_FIELDS_ARG.search(decl)
        if m:
            first = m.group(1).split(',', 1)[0].strip()
            if first:
                cols.add(first)
    return cols


def _unique_scalar_columns(body: str) -> set[str]:
    """Columns with an inline `@unique` field attribute.

    Prisma/Postgres creates an implicit unique index for these (e.g. the
    parent-side FK of a bridge model, which carries `@unique` instead of
    `@@index`), so they count as indexed even without an explicit
    `@@index([...])` declaration.
    """
    return set(_UNIQUE_SCALAR.findall(body))


def validate_prisma_indexes(schema_path: str | Path) -> None:
    """Verify every model has @@index for required hot columns.

    A column counts as indexed when it appears as the leftmost column of some
    @@index([...]) declaration on the same model — that's what the Postgres
    planner can use for filtering on that single column.

    Raises SchemaValidationError listing every missing index so the author
    fixes them in one pass.
    """
    path = Path(schema_path)
    if not path.exists():
        raise SchemaValidationError(
            f"Prisma schema not found at {path} — required for index validation."
        )
    text = path.read_text()

    errors: list[str] = []
    for name, body in _iter_model_blocks(text):
        indexed = _leftmost_indexed_columns(body) | _unique_scalar_columns(body)
        required_cols = set(_REQUIRED_INDEX_COLUMNS) | _relation_fk_columns(body)
        for col in sorted(required_cols):
            if _model_has_column(body, col) and col not in indexed:
                errors.append(
                    f"model '{name}': missing required @@index([{col}]).  "
                    f"Postgres does not auto-index this column; queries that filter "
                    f"on it (FK/bridge lookups, Creator/Assignee scoping, org "
                    f"filtering) will fall back to a full table scan.  Run "
                    f"`python3 scripts/add_required_indexes.py` to add it, or write "
                    f"`@@index([{col}])` (or a composite starting with this column) "
                    f"by hand."
                )

    if errors:
        bullet_list = '\n'.join(f"  • {e}" for e in errors)
        raise SchemaValidationError(
            f"Prisma index validation failed — {len(errors)} model(s) missing "
            f"required indexes:\n\n{bullet_list}\n"
        )


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
            if not rel or rel.get('type') not in ('many-to-one', 'one-to-one', 'one-to-one_bridge'):
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

            # 2c. labelField (string | dotted path | list of either) must
            # resolve through the target's properties / outbound relations.
            if label_field:
                try:
                    resolve_label_paths(label_field, target, schema)
                except ValueError as exc:
                    errors.append(
                        f"Definition '{def_key}', property '{prop_name}': {exc}"
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
            if label_field:
                try:
                    resolve_label_paths(label_field, target, schema)
                except ValueError as exc:
                    errors.append(
                        f"Definition '{def_key}', x-relationships '{rel_prop}': {exc}"
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
    # 5. x-reservation entity-level validation
    # -----------------------------------------------------------------------
    for def_key, defn in defs.items():
        if not _SNAKE_CASE.match(def_key):
            continue
        xres = defn.get('x-reservation')
        if not xres:
            continue
        if not isinstance(xres, dict):
            errors.append(
                f"Definition '{def_key}': x-reservation must be a mapping, got {type(xres).__name__}."
            )
            continue
        mode = xres.get('mode')
        if mode not in ('count', 'item'):
            errors.append(
                f"Definition '{def_key}': x-reservation.mode must be 'count' or 'item', got {mode!r}."
            )
            continue

        pool   = xres.get('pool') or {}
        result = xres.get('result') or {}
        lines  = xres.get('lines')

        # pool.entity is required for all modes
        pool_entity = pool.get('entity')
        if not pool_entity:
            errors.append(
                f"Definition '{def_key}': x-reservation.pool.entity is required."
            )
        elif pool_entity not in defs:
            errors.append(
                f"Definition '{def_key}': x-reservation.pool.entity '{pool_entity}' is not "
                f"defined in the schema."
            )

        if mode == 'count':
            req = xres.get('request') or {}
            # Required pool fields for count mode
            for required_pool_key in ('quantityField', 'reservedField'):
                if not pool.get(required_pool_key):
                    errors.append(
                        f"Definition '{def_key}': x-reservation.pool.{required_pool_key} is required "
                        f"for count mode."
                    )
            if not req.get('quantityField'):
                errors.append(
                    f"Definition '{def_key}': x-reservation.request.quantityField is required "
                    f"for count mode."
                )
            # Required result fields for count mode
            alloc_entity = result.get('allocationEntity')
            if not alloc_entity:
                errors.append(
                    f"Definition '{def_key}': x-reservation.result.allocationEntity is required "
                    f"for count mode."
                )
            elif alloc_entity not in defs:
                errors.append(
                    f"Definition '{def_key}': x-reservation.result.allocationEntity '{alloc_entity}' "
                    f"is not defined in the schema."
                )
            if not result.get('parentField'):
                errors.append(
                    f"Definition '{def_key}': x-reservation.result.parentField is required "
                    f"for count mode."
                )
            # Mode × lines matrix (count)
            if lines:
                # (D) count + lines specified → result.lineField required
                if not result.get('lineField'):
                    errors.append(
                        f"Definition '{def_key}': x-reservation.result.lineField is required "
                        f"for count mode with 'lines'."
                    )
            else:
                # (C) count + lines omitted → request.quantityField must exist on the entity
                req_qty_field = req.get('quantityField')
                entity_props  = defn.get('properties', {})
                if req_qty_field and req_qty_field not in entity_props:
                    errors.append(
                        f"Definition '{def_key}': x-reservation.request.quantityField "
                        f"'{req_qty_field}' does not exist on entity '{def_key}' properties "
                        f"(count mode without lines: the quantity must be a field on the "
                        f"request entity itself)."
                    )

        elif mode == 'item':
            # Mode × lines matrix (item)
            if lines:
                # (B) item + lines specified → reject (Phase 2 reserved)
                errors.append(
                    f"Definition '{def_key}': x-reservation: item mode with 'lines' is "
                    f"reserved for Phase 2."
                )
            else:
                # (A) item + lines omitted → result.allocatedField required
                if not result.get('allocatedField'):
                    errors.append(
                        f"Definition '{def_key}': x-reservation.result.allocatedField is "
                        f"required for item mode without lines."
                    )

        # lines dict format: validate entity/field existence
        if isinstance(lines, dict):
            lines_entity_name = lines.get('entity')
            lines_field_name  = lines.get('field')
            if lines_entity_name:
                if lines_entity_name not in defs:
                    errors.append(
                        f"Definition '{def_key}': x-reservation.lines.entity "
                        f"'{lines_entity_name}' is not defined in the schema."
                    )
                elif lines_field_name:
                    lines_entity_props = defs[lines_entity_name].get('properties', {})
                    if lines_field_name not in lines_entity_props:
                        errors.append(
                            f"Definition '{def_key}': x-reservation.lines.field "
                            f"'{lines_field_name}' does not exist on entity "
                            f"'{lines_entity_name}'."
                        )

    # -----------------------------------------------------------------------
    # 6. x-display list primary field — required + non-nullable + labelField
    # -----------------------------------------------------------------------
    def _is_optional_field(field_name: str, field_props: dict, req_set: set) -> bool:
        """True when field is absent from required list OR has 'null' in type union."""
        if field_name not in req_set:
            return True
        fdef = field_props.get(field_name, {})
        t = fdef.get('type')
        return isinstance(t, list) and 'null' in t

    for entity in entities:
        model     = entity['model']
        model_def = defs.get(model, {})
        props     = model_def.get('properties', {})
        req_set   = set(model_def.get('required') or [])

        xdisplay = model_def.get('x-display') or {}
        if isinstance(xdisplay, list):
            table = xdisplay
        elif isinstance(xdisplay, dict):
            table = xdisplay.get('table') or []
        else:
            continue

        # Locate the primary display field (first entry with primary: true)
        primary_field: str | None = None
        for item in table:
            if not isinstance(item, dict):
                continue
            for field_name, cfg in item.items():
                if isinstance(cfg, dict) and cfg.get('primary'):
                    primary_field = field_name
                    break
            if primary_field:
                break

        if primary_field is None:
            continue

        fk_prop = f'{primary_field}_id'

        if fk_prop in props:
            # Primary field is a FK (e.g. primary='room_type' → fk_prop='room_type_id')
            if _is_optional_field(fk_prop, props, req_set):
                errors.append(
                    f"Entity '{model}': list primary field '{primary_field}' must be "
                    f"required (non-nullable). '{fk_prop}' is optional or nullable — "
                    f"the list view primary column would render null/empty on rows "
                    f"where the FK is unset."
                )
                continue

            # Check labelField paths on the FK's x-relationship
            fk_rel     = (props[fk_prop].get('x-relationship') or {})
            target     = fk_rel.get('target')
            lf_raw     = fk_rel.get('labelField')

            if not target or target not in defs or not lf_raw:
                continue

            # Normalise labelField to a list (supports str and list[str])
            if isinstance(lf_raw, str):
                lf_paths = [lf_raw] if lf_raw else []
            elif isinstance(lf_raw, list):
                lf_paths = [p for p in lf_raw if isinstance(p, str) and p]
            else:
                lf_paths = []

            for lf_path in lf_paths:
                segments = lf_path.split('.')
                cursor   = target

                for i, seg in enumerate(segments):
                    cursor_def   = defs.get(cursor, {})
                    cursor_props = cursor_def.get('properties', {}) or {}
                    cursor_req   = set(cursor_def.get('required') or [])
                    is_last      = (i == len(segments) - 1)

                    if is_last:
                        if seg not in cursor_props:
                            break  # path error already caught by section 2c
                        if _is_optional_field(seg, cursor_props, cursor_req):
                            errors.append(
                                f"Entity '{model}': list primary field '{primary_field}' "
                                f"labelField path '{lf_path}': final field '{seg}' on "
                                f"'{cursor}' must be required (non-nullable)."
                            )
                    else:
                        # Intermediate segment: resolve via {seg}_id FK
                        rel_fk     = f'{seg}_id'
                        rel_target = (
                            (cursor_props.get(rel_fk) or {})
                            .get('x-relationship', {})
                            .get('target')
                        )
                        if not rel_target or rel_target not in defs:
                            break
                        cursor = rel_target

        elif primary_field in props:
            # Primary field is a plain scalar (e.g. primary='name')
            if _is_optional_field(primary_field, props, req_set):
                errors.append(
                    f"Entity '{model}': list primary field '{primary_field}' must be "
                    f"required (non-nullable)."
                )

    # -----------------------------------------------------------------------
    # 7. x-internal entity validation
    # -----------------------------------------------------------------------
    _REQUIRED_INTERNAL_KEYS = ('page', 'embed', 'api')
    for def_key, defn in defs.items():
        if not _SNAKE_CASE.match(def_key):
            continue
        x_internal = defn.get('x-internal')
        if x_internal is None:
            continue
        if not isinstance(x_internal, dict):
            errors.append(
                f"Definition '{def_key}': x-internal must be a mapping with "
                f"keys page, embed, api."
            )
            continue
        for key in _REQUIRED_INTERNAL_KEYS:
            if key not in x_internal:
                errors.append(
                    f"Definition '{def_key}': x-internal is missing required key '{key}'. "
                    f"Expected keys: page, embed, api."
                )

        # Enum bounds: maximum - minimum + 1 must equal len(enum labels)
        for prop_name, prop_def in defn.get('properties', {}).items():
            if prop_def.get('type') != 'integer':
                continue
            enum_vals = prop_def.get('enum')
            if not isinstance(enum_vals, list):
                continue
            minimum = prop_def.get('minimum')
            maximum = prop_def.get('maximum')
            if minimum is None or maximum is None:
                continue
            expected_count = maximum - minimum + 1
            if len(enum_vals) != expected_count:
                errors.append(
                    f"Definition '{def_key}', property '{prop_name}': "
                    f"integer enum labels count ({len(enum_vals)}) does not match "
                    f"minimum/maximum range ({minimum}..{maximum} = {expected_count} values). "
                    f"Adjust enum labels or minimum/maximum to match."
                )

    # -----------------------------------------------------------------------
    # 6. x-bridge validation (new object form — clean break, array form rejected)
    # -----------------------------------------------------------------------
    for def_key, defn in defs.items():
        if not _SNAKE_CASE.match(def_key):
            continue
        x_bridge = defn.get('x-bridge')
        if x_bridge is None:
            continue
        # Clean break: old array form with role/via/kind is no longer supported.
        if isinstance(x_bridge, list):
            errors.append(
                f"Definition '{def_key}': x-bridge must be an object (new form); "
                f"got a list. The old array form with role/via/kind is no longer "
                f"supported. Migrate to: {{name: <bridge_model>, child: {def_key}, "
                f"parentCardinality: exactlyOne, "
                f"parents: [{{role: ..., target: ..., labelField: ...}}]}}."
            )
            continue
        if not isinstance(x_bridge, dict):
            errors.append(
                f"Definition '{def_key}': x-bridge must be an object mapping; "
                f"got {type(x_bridge).__name__}."
            )
            continue
        # Validate required keys in object form
        for required_key in ('name', 'child', 'parents'):
            if required_key not in x_bridge:
                errors.append(
                    f"Definition '{def_key}': x-bridge missing required key "
                    f"'{required_key}'. Required: name (bridge model name), "
                    f"child (child entity name), parents (list of parent entries)."
                )
        bridge_name = x_bridge.get('name', '')
        child_name  = x_bridge.get('child', '')
        parents     = x_bridge.get('parents', [])
        # bridge model must exist in definitions
        if bridge_name and bridge_name not in defs:
            errors.append(
                f"Definition '{def_key}': x-bridge name '{bridge_name}' not found "
                f"in definitions. Add a '{bridge_name}' bridge model definition."
            )
        # child must match the entity declaring x-bridge
        if child_name and child_name != def_key:
            errors.append(
                f"Definition '{def_key}': x-bridge child '{child_name}' must match "
                f"the declaring entity name '{def_key}'."
            )
        if not isinstance(parents, list):
            errors.append(
                f"Definition '{def_key}': x-bridge parents must be a list; "
                f"got {type(parents).__name__}."
            )
        else:
            for i, p_entry in enumerate(parents):
                if not isinstance(p_entry, dict):
                    errors.append(
                        f"Definition '{def_key}': x-bridge parents[{i}] must be "
                        f"a mapping; got {type(p_entry).__name__}."
                    )
                    continue
                for req_key in ('role', 'target'):
                    if req_key not in p_entry:
                        errors.append(
                            f"Definition '{def_key}': x-bridge parents[{i}] "
                            f"missing required key '{req_key}'."
                        )
                p_target = p_entry.get('target', '')
                if p_target and p_target not in defs:
                    errors.append(
                        f"Definition '{def_key}': x-bridge parents[{i}] target "
                        f"'{p_target}' not found in definitions."
                    )

    # -----------------------------------------------------------------------
    # 8. x-pii field annotation validation
    # -----------------------------------------------------------------------
    _VALID_PII_VALUES = {'direct', 'indirect', 'sensitive', 'none'}
    for def_key, defn in defs.items():
        if not _SNAKE_CASE.match(def_key):
            continue
        props = defn.get('properties', {})
        for prop_name, prop_def in props.items():
            if not isinstance(prop_def, dict):
                continue
            pii_val = prop_def.get('x-pii')
            if pii_val is not None and pii_val not in _VALID_PII_VALUES:
                errors.append(
                    f"Definition '{def_key}', property '{prop_name}': "
                    f"x-pii value '{pii_val}' is not valid.  "
                    f"Allowed values: {sorted(_VALID_PII_VALUES)}."
                )

    # -----------------------------------------------------------------------
    # 9. x-gdpr-mode annotation validation (model-level and field-level)
    # -----------------------------------------------------------------------
    _VALID_GDPR_MODE_VALUES = {'internal', 'consumer', 'both'}
    for def_key, defn in defs.items():
        if not _SNAKE_CASE.match(def_key):
            continue
        gdpr_mode_val = defn.get('x-gdpr-mode')
        if gdpr_mode_val is not None and gdpr_mode_val not in _VALID_GDPR_MODE_VALUES:
            errors.append(
                f"Definition '{def_key}': "
                f"x-gdpr-mode value '{gdpr_mode_val}' is not valid. "
                f"Allowed values: {sorted(_VALID_GDPR_MODE_VALUES)}."
            )
        props = defn.get('properties', {})
        for prop_name, prop_def in props.items():
            if not isinstance(prop_def, dict):
                continue
            gdpr_mode_field_val = prop_def.get('x-gdpr-mode')
            if gdpr_mode_field_val is not None and gdpr_mode_field_val not in _VALID_GDPR_MODE_VALUES:
                errors.append(
                    f"Definition '{def_key}', property '{prop_name}': "
                    f"x-gdpr-mode value '{gdpr_mode_field_val}' is not valid. "
                    f"Allowed values: {sorted(_VALID_GDPR_MODE_VALUES)}."
                )

    # -----------------------------------------------------------------------
    # 10. x-import-key ⊆ V1 export allowlist  (IA-8)
    # -----------------------------------------------------------------------
    # For every entity that carries x-import-key:
    #   • direct fields (e.g. "name") must exist in the entity's properties
    #     and must not be a system/FK column (otherwise they would be excluded
    #     from export_scalar_fields and the round-trip CSV would be unusable).
    #   • dotted-FK fields (e.g. "role.name") must reference an existing target
    #     entity that has the lookup field in its own properties.
    _IMPORT_SYSTEM_FIELDS = {
        'id', 'created_at', 'updated_at', 'creator_id', 'updater_id',
        'organization_id', 'tenant_id', 'assignee_id',
    }
    for def_key, defn in defs.items():
        if not _SNAKE_CASE.match(def_key):
            continue
        _import_key_raw = defn.get('x-import-key', [])
        if not _import_key_raw:
            continue
        if isinstance(_import_key_raw, str):
            _import_key_raw = [_import_key_raw]
        _entity_props = defn.get('properties', {})
        for _raw_key in _import_key_raw:
            if '.' in _raw_key:
                # Dotted FK: e.g. "role.name" → look up 'role' entity, check 'name' field
                _fk_ent, _fk_field = _raw_key.split('.', 1)
                if _fk_ent not in defs:
                    errors.append(
                        f"Definition '{def_key}': x-import-key '{_raw_key}' references "
                        f"entity '{_fk_ent}' which is not defined in the schema.  "
                        f"Add a '{_fk_ent}' definition or correct the key."
                    )
                elif _fk_field not in defs[_fk_ent].get('properties', {}):
                    errors.append(
                        f"Definition '{def_key}': x-import-key '{_raw_key}': field "
                        f"'{_fk_field}' does not exist on entity '{_fk_ent}'.  "
                        f"The dotted-FK lookup would fail at import time."
                    )
            else:
                # Direct field: must exist in entity's properties
                if _raw_key not in _entity_props:
                    errors.append(
                        f"Definition '{def_key}': x-import-key field '{_raw_key}' "
                        f"does not exist in the entity's properties.  "
                        f"Add it to the schema or remove it from x-import-key."
                    )
                elif _raw_key.endswith('_id') or _raw_key in _IMPORT_SYSTEM_FIELDS:
                    errors.append(
                        f"Definition '{def_key}': x-import-key field '{_raw_key}' "
                        f"is a system/FK field that is excluded from the V1 export "
                        f"allowlist (export_scalar_fields).  The exported CSV will not "
                        f"contain this column, so a round-trip import would fail.  "
                        f"Use a natural-key field instead."
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
