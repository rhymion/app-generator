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
        leftmost = _leftmost_indexed_columns(body)
        for col in _REQUIRED_INDEX_COLUMNS:
            if _model_has_column(body, col) and col not in leftmost:
                errors.append(
                    f"model '{name}': missing required @@index([{col}]).  "
                    f"Postgres does not auto-index this column; queries that filter "
                    f"on it (Creator/Assignee scoping, org filtering) will fall back "
                    f"to a full table scan.  Run `python3 scripts/add_required_indexes.py` "
                    f"to add it, or write `@@index([{col}])` (or a composite starting "
                    f"with this column) by hand."
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

        # Validate ALL table columns that carry labelField in their column config.
        # primary: true is NOT required — any FK column with a table-level labelField
        # must have a required (non-nullable) FK so the list view never renders blank.
        for _item in table:
            if not isinstance(_item, dict):
                continue
            for _col_name, _col_cfg in _item.items():
                if not isinstance(_col_cfg, dict):
                    continue
                _lf_raw = _col_cfg.get('labelField')
                if not _lf_raw:
                    continue

                _col_fk = f'{_col_name}_id'
                if _col_fk not in props:
                    continue

                if _is_optional_field(_col_fk, props, req_set):
                    errors.append(
                        f"Entity '{model}': list column '{_col_name}' has labelField "
                        f"but '{_col_fk}' is optional or nullable — "
                        f"the list view column would render null/empty on rows "
                        f"where the FK is unset."
                    )
                    continue

                # Validate the labelField path on the FK's target entity.
                # Table-level labelField format: "{fk_prop}.{rest}" where the first
                # segment is the FK field name on this entity; strip it to get the
                # path relative to the target.
                _col_fk_rel = (props[_col_fk].get('x-relationship') or {})
                _col_target = _col_fk_rel.get('target')
                if not _col_target or _col_target not in defs:
                    continue

                if isinstance(_lf_raw, str):
                    _col_lf_paths = [_lf_raw] if _lf_raw else []
                elif isinstance(_lf_raw, list):
                    _col_lf_paths = [p for p in _lf_raw if isinstance(p, str) and p]
                else:
                    _col_lf_paths = []

                for _lf_path in _col_lf_paths:
                    _segs = _lf_path.split('.')
                    # Strip leading FK-field prefix (e.g. "room_id.room_no" → ["room_no"])
                    _path_segs = _segs[1:] if _segs[0] == _col_fk else _segs
                    if not _path_segs:
                        continue

                    _cursor = _col_target
                    for _i, _seg in enumerate(_path_segs):
                        _cursor_def   = defs.get(_cursor, {})
                        _cursor_props = _cursor_def.get('properties', {}) or {}
                        _cursor_req   = set(_cursor_def.get('required') or [])
                        _is_last      = (_i == len(_path_segs) - 1)
                        if _is_last:
                            if _seg not in _cursor_props:
                                break  # unknown segment — caught by section 2c
                            if _is_optional_field(_seg, _cursor_props, _cursor_req):
                                errors.append(
                                    f"Entity '{model}': list column '{_col_name}' "
                                    f"labelField path '{_lf_path}': final field '{_seg}' "
                                    f"on '{_cursor}' must be required (non-nullable)."
                                )
                        else:
                            _rel_fk     = f'{_seg}_id'
                            _rel_target = (
                                (_cursor_props.get(_rel_fk) or {})
                                .get('x-relationship', {})
                                .get('target')
                            )
                            if not _rel_target or _rel_target not in defs:
                                break
                            _cursor = _rel_target

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
    # Report
    # -----------------------------------------------------------------------
    if errors:
        bullet_list = '\n'.join(f"  • {e}" for e in errors)
        raise SchemaValidationError(
            f"Schema validation failed — {len(errors)} error(s) must be fixed "
            f"before generation can proceed:\n\n{bullet_list}\n"
        )
