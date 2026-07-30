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
from helpers.schema_helpers import (
    get_parent_relationships, get_internal_bridge_fk_prop_names,
    get_entity_properties, get_entity_required,
)

_SNAKE_CASE = re.compile(r'^(__)?[a-z][a-z0-9_]*$')
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


# ---------------------------------------------------------------------------
# x-import-key visibility contract (cmd_394 §8, DP-1a)
# ---------------------------------------------------------------------------
_EXPORT_SYSTEM_FIELDS = {
    'id', 'created_at', 'updated_at', 'creator_id', 'updater_id',
    'organization_id', 'tenant_id',
}


def _is_export_scalar_type(prop_def: dict) -> bool:
    ptype = prop_def.get('type')
    if isinstance(ptype, list):  # nullable scalar, e.g. ['string', 'null']
        return True
    return ptype in ('string', 'integer', 'number', 'boolean')


def _compute_export_visibility(def_key: str, defn: dict, defs: dict) -> tuple[set, set]:
    """Standalone (schema-only) mirror of build_context.py's
    export_scalar_fields / x_relationships_list computation — kept in sync by
    hand (see cmd_394 §8). Returns (export_scalar_fields, fk_display_cols) for
    the base entity `def_key`.

    fk_display_cols uses the DP-2 naming ('{relation}_{labelField}'), so a
    dotted x-import-key is visible only when the FK's own labelField equals
    the dotted key's field AND is a plain string (not a composite list —
    composite labelFields are excluded from export entirely, cmd_351).
    """
    gen_cfg = defs.get(f'{def_key}_detail', {}).get('x-generate') or defn.get('x-generate') or {}
    props = defn.get('properties', {})
    parent_rels = get_parent_relationships(defn)
    # cmd_420: also exclude FKs to internal bridge models (approvable_id,
    # inventory_transactionable_id, ...) — invisible to get_parent_relationships()
    # alone, see get_internal_bridge_fk_prop_names() docstring.
    fk_prop_names = {r['prop_name'] for r in parent_rels} | get_internal_bridge_fk_prop_names(defn, {'definitions': defs})
    candidates = gen_cfg.get('fields') or list(props.keys())
    view_visible = set(candidates)
    export_scalar_fields = {
        f for f in candidates
        if f not in _EXPORT_SYSTEM_FIELDS
        and f not in fk_prop_names
        and f in props
        and _is_export_scalar_type(props[f])
    }
    # DP-1 UNION (build_context.py): non-dotted x-import-key fields already in
    # the view-visible allowlist are unioned in, mirrored here so this
    # function agrees with what actually gets exported.
    _import_key_raw = defn.get('x-import-key') or []
    if isinstance(_import_key_raw, str):
        _import_key_raw = [_import_key_raw]
    for _f in _import_key_raw:
        if '.' not in _f and _f not in export_scalar_fields and _f in view_visible:
            export_scalar_fields.add(_f)
    fk_display_cols = {
        f"{r['prop_name'].removesuffix('_id')}_{r['label_field']}"
        for r in parent_rels
        if isinstance(r['label_field'], str)
    }
    return export_scalar_fields, fk_display_cols


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

            target_props = get_entity_properties(target, schema)

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

            # 2e. x-autocomplete-context (DP-5, cmd_377/379): field names must
            # exist on THIS entity. formValues are pulled from the form
            # instance that holds this FK field (the caller), not from the
            # relationship target — see the autocomplete filter hook design.
            actx = prop_def.get('x-autocomplete-context')
            if actx is not None:
                if not isinstance(actx, list) or not all(isinstance(f, str) for f in actx):
                    errors.append(
                        f"Definition '{def_key}', property '{prop_name}': "
                        f"x-autocomplete-context must be a list of field name strings."
                    )
                else:
                    for field_name in actx:
                        if field_name not in props:
                            errors.append(
                                f"Definition '{def_key}', property '{prop_name}': "
                                f"x-autocomplete-context references field '{field_name}', "
                                f"which is not a property of '{def_key}'.  "
                                f"formValues are pulled from this entity's own form state, "
                                f"not from the relationship target '{target}'."
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
            target_props = get_entity_properties(target, schema)
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
        # x-display lives on the raw entity (__model); fall back to the bare
        # key for special pass-through entities with no raw counterpart
        # (e.g. 'setting', whose allOf proxies the 'user' view directly).
        model_def = defs.get(f'__{model}', defs.get(model, {}))
        props     = get_entity_properties(model, schema)

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
            child_props = get_entity_properties(child['name'], schema)
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

        # x-reservation.actions was deprecated 2026-07-30: approval/rejection lifecycle
        # goes through approval_flow's approve/(terminal) reject, not bespoke x-reservation
        # action routes. x-reservation itself is retained, scoped to (1) inventory
        # allocation and (2) specific-resource reservation. See
        # docs/knowledge/appendix/inventory-reservation-split.md.
        if xres.get('actions'):
            errors.append(
                f"Definition '{def_key}': x-reservation.actions is deprecated — use "
                f"approval_flow's approve/(terminal) reject instead. Remove the "
                f"'actions' block."
            )

        pool   = xres.get('pool') or {}
        result = xres.get('result') or {}
        lines  = xres.get('lines')
        xres_transaction = xres.get('transaction') or {}
        strategy = xres_transaction.get('strategy', 'conditional_update')
        is_ledger_transaction = strategy == 'ledger_transaction'

        # OD-1: pool.entity is required for all modes, UNLESS the entity
        # resolves its pool via transaction.ledgerDomain (x-ledger-entities).
        ledger_domain_key = xres_transaction.get('ledgerDomain')
        if not ledger_domain_key:
            pool_entity = pool.get('entity')
            if not pool_entity:
                errors.append(
                    f"Definition '{def_key}': x-reservation.pool.entity is required "
                    f"(or declare transaction.ledgerDomain to resolve pool from x-ledger-entities)."
                )
            elif pool_entity not in defs:
                errors.append(
                    f"Definition '{def_key}': x-reservation.pool.entity '{pool_entity}' is not "
                    f"defined in the schema."
                )
        else:
            all_ledger_domains = schema.get('x-ledger-entities') or {}
            if ledger_domain_key not in all_ledger_domains:
                errors.append(
                    f"Definition '{def_key}': x-reservation.transaction.ledgerDomain "
                    f"'{ledger_domain_key}' is not declared in x-ledger-entities."
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
            if is_ledger_transaction:
                # strategy: ledger_transaction has no allocationEntity — the ledger
                # (inventory_transaction) IS the allocation record. It writes directly
                # to the line entity's bridge FK instead.
                if not result.get('lineTransactionableField'):
                    errors.append(
                        f"Definition '{def_key}': x-reservation.result.lineTransactionableField "
                        f"is required for count mode with strategy: ledger_transaction."
                    )
            else:
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
                # (ledger_transaction strategy uses lineTransactionableField instead,
                # already validated above)
                if not is_ledger_transaction and not result.get('lineField'):
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

            # Overlap mode specific validations
            _item_policy = xres.get('policy') or {}
            _avail_src = _item_policy.get('availabilitySource')
            if _avail_src == 'overlap':
                _req = xres.get('request') or {}
                _criteria = _req.get('criteria') or {}
                _has_daterange = (
                    'dateRange' in _req or 'dateRange' in _criteria
                )
                if not _has_daterange:
                    errors.append(
                        f"Definition '{def_key}': x-reservation.policy.availabilitySource "
                        f"'overlap' requires x-reservation.request.criteria.dateRange to be set."
                    )
                # excludePoolStatuses must be a list of integers
                _excl = _item_policy.get('excludePoolStatuses')
                if _excl is not None:
                    if not isinstance(_excl, list):
                        errors.append(
                            f"Definition '{def_key}': x-reservation.policy.excludePoolStatuses "
                            f"must be a list of integers."
                        )
                    else:
                        for _v in _excl:
                            if not isinstance(_v, int):
                                errors.append(
                                    f"Definition '{def_key}': x-reservation.policy.excludePoolStatuses "
                                    f"values must be integers, got {_v!r}."
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
                    lines_entity_props = get_entity_properties(lines_entity_name, schema)
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
        model_def = defs.get(f'__{model}', defs.get(model, {}))
        props     = get_entity_properties(model, schema)
        req_set   = get_entity_required(model, schema)

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
                    cursor_props = get_entity_properties(cursor, schema)
                    cursor_req   = get_entity_required(cursor, schema)
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
    # 10. x-import-key visibility contract (IA-8 / E_IMPORT_KEY_INVISIBLE,
    #     cmd_394 §8 DP-1a)
    # -----------------------------------------------------------------------
    # For every entity that carries x-import-key:
    #   • direct fields (e.g. "name") must exist in the entity's properties
    #     AND must actually be visible in the exported CSV
    #     (export_scalar_fields, including the DP-1 view-visible UNION).
    #   • dotted-FK fields (e.g. "role.name") must reference an existing target
    #     entity that has the lookup field in its own properties, AND the FK's
    #     own labelField must equal that field as a plain string (not a
    #     composite list) so the value actually appears as an export display
    #     column (DP-2 naming: '{relation}_{labelField}').
    # A key that fails this check means KEY_COLUMNS will include a column not
    # present in the exported CSV — api_import_route.ts.jinja2 rejects EVERY
    # row with 400 MISSING_COLUMN before any row is processed (cmd_394 §9c).
    for def_key, defn in defs.items():
        if not _SNAKE_CASE.match(def_key):
            continue
        _import_key_raw = defn.get('x-import-key', [])
        if not _import_key_raw:
            continue
        if isinstance(_import_key_raw, str):
            _import_key_raw = [_import_key_raw]
        _entity_props = defn.get('properties', {})
        _export_scalars, _fk_display = _compute_export_visibility(def_key, defn, defs)
        for _raw_key in _import_key_raw:
            if '.' in _raw_key:
                # Dotted FK: e.g. "approver_role.name" → the entity to look up is
                # the FK property's x-relationship.target, NOT the dotted-key
                # prefix itself (DP-2a, cmd_394 §12).  These diverge whenever the
                # FK uses an aliased property name — e.g. approver_role_id targets
                # entity 'role', not a (nonexistent) 'approver_role' entity.
                _fk_prefix, _fk_field = _raw_key.split('.', 1)
                _fk_col = f'{_fk_prefix}_id'
                _fk_prop = _entity_props.get(_fk_col)
                if _fk_prop is None:
                    errors.append(
                        f"Definition '{def_key}': x-import-key '{_raw_key}' expects "
                        f"a FK property '{_fk_col}' which does not exist on this "
                        f"entity.  Correct the key prefix or add the '{_fk_col}' "
                        f"property."
                    )
                    continue
                _fk_target = _fk_prop.get('x-relationship', {}).get('target', _fk_prefix)
                if _fk_target not in defs:
                    errors.append(
                        f"Definition '{def_key}': x-import-key '{_raw_key}' resolves "
                        f"(via '{_fk_col}'.x-relationship.target) to entity "
                        f"'{_fk_target}' which is not defined in the schema.  Add a "
                        f"'{_fk_target}' definition or correct the key."
                    )
                    continue
                # get_entity_properties resolves raw (__x) vs view (x) property
                # location correctly, unlike a direct defs[_fk_target]['properties']
                # lookup — required when _fk_target is a bare view entity name.
                if _fk_field not in get_entity_properties(_fk_target, schema):
                    errors.append(
                        f"Definition '{def_key}': x-import-key '{_raw_key}': field "
                        f"'{_fk_field}' does not exist on entity '{_fk_target}' "
                        f"(resolved via '{_fk_col}'.x-relationship.target).  The "
                        f"dotted-FK lookup would fail at import time."
                    )
                    continue
                _display_col = f'{_fk_prefix}_{_fk_field}'
                if _display_col not in _fk_display:
                    errors.append(
                        f"Definition '{def_key}': x-import-key '{_raw_key}' "
                        f"(E_IMPORT_KEY_INVISIBLE) is not present in the exported "
                        f"CSV columns for '{def_key}_detail'.  The FK property "
                        f"'{_fk_col}' must have labelField='{_fk_field}' (a plain "
                        f"string, not a composite list) for '{_display_col}' to "
                        f"appear as an export display column.  Consequence: the "
                        f"import route will reject every CSV row with "
                        f"MISSING_COLUMN."
                    )
            else:
                # Direct field: must exist in entity's properties AND be
                # visible in the exported CSV.
                if _raw_key not in _entity_props:
                    errors.append(
                        f"Definition '{def_key}': x-import-key field '{_raw_key}' "
                        f"does not exist in the entity's properties.  "
                        f"Add it to the schema or remove it from x-import-key."
                    )
                elif _raw_key not in _export_scalars:
                    errors.append(
                        f"Definition '{def_key}': x-import-key field '{_raw_key}' "
                        f"(E_IMPORT_KEY_INVISIBLE) is not present in the exported "
                        f"CSV columns for '{def_key}_detail'.  Either it is a "
                        f"system/FK column (always excluded) or it is missing from "
                        f"x-generate.fields (the view-visible allowlist).  "
                        f"Consequence: the import route will reject every CSV row "
                        f"with MISSING_COLUMN.  Use a natural-key field that is "
                        f"already visible in the view, or add it to "
                        f"x-generate.fields."
                    )

    # -----------------------------------------------------------------------
    # 11. Composite x-import-key referenced via a single-field labelField
    #     (E_COMPOSITE_KEY_AMBIGUOUS_LABEL, cmd_394 §5/§13 — fail-loud only;
    #     a full composite-key roundtrip redesign is out of scope for this
    #     schema check and is tracked as a separate follow-up cmd)
    # -----------------------------------------------------------------------
    # When a target entity T has a COMPOSITE natural key (x-import-key with
    # 2+ parts), any FK relation elsewhere that displays T via a single-field
    # labelField cannot uniquely identify a T row from the exported CSV
    # alone — multiple T rows can share that one labelField value while
    # differing in the other key parts (e.g. approval_flow keyed on
    # [entity_name, approver_role.name, requestor_role.name] but referenced
    # via labelField: entity_name alone — several approval_flow rows can
    # share the same entity_name). The roundtrip silently degrades to
    # "matches whichever row comes first" instead of failing loudly, so we
    # surface it here instead.
    for _target_key, _target_defn in defs.items():
        if not _SNAKE_CASE.match(_target_key):
            continue
        _target_import_key = _target_defn.get('x-import-key') or []
        if isinstance(_target_import_key, str):
            _target_import_key = [_target_import_key]
        if len(_target_import_key) < 2:
            continue  # not composite
        _non_dotted_key_parts = {k for k in _target_import_key if '.' not in k}
        if not _non_dotted_key_parts:
            continue
        for _ref_key, _ref_defn in defs.items():
            if not _SNAKE_CASE.match(_ref_key) or _ref_key == _target_key:
                continue
            for _rel in get_parent_relationships(_ref_defn):
                if _rel['target'] != _target_key:
                    continue
                _label = _rel['label_field']
                if isinstance(_label, str) and _label in _non_dotted_key_parts:
                    errors.append(
                        f"Definition '{_ref_key}', property '{_rel['prop_name']}' "
                        f"(E_COMPOSITE_KEY_AMBIGUOUS_LABEL): labelField "
                        f"'{_label}' displays only one part of target "
                        f"'{_target_key}''s composite x-import-key "
                        f"{_target_import_key}.  Multiple '{_target_key}' rows "
                        f"can share the same '{_label}' value, so CSV "
                        f"export/import cannot uniquely identify a row through "
                        f"this FK display column — the roundtrip is provably "
                        f"ambiguous.  A composite-key roundtrip redesign is "
                        f"required to fix this properly and is out of scope "
                        f"here (cmd_394 §13); for now, treat '{_target_key}' as "
                        f"export/UI-reference only through this relation, or "
                        f"pick a labelField that is independently unique."
                    )

    # -----------------------------------------------------------------------
    # 12. Contradictory import configuration (E_IMPORT_KEY_NOT_ELIGIBLE,
    #     cmd_426): a base entity that declares x-import-key with the import
    #     route left on (x-generate.import: true, the default) must actually
    #     be reachable as a primary, create-or-edit-able entity — otherwise
    #     x-import-key advertises an import path that build_context.py's
    #     import_eligible gate (§ "Import eligibility — SINGLE PLACE",
    #     cmd_328/330) silently disables, and nothing ever tells the schema
    #     author why.
    #
    #     Structural condition mirrored 1:1 from build_context.py's
    #     import_eligible formula (no entity names hardcoded — this walks
    #     every base model definition uniformly):
    #       has_import_key AND import_flag(default True) AND
    #       NOT(is_primary_entity AND (can_create OR can_update))
    #
    #     The doc comment on x-import-key (top of this schema) already names
    #     the sanctioned way to keep x-import-key for export/dotted-FK-target
    #     purposes while opting out of the entity's own import route:
    #     x-generate.import: false. That case is intentionally NOT an error
    #     here — only entities where the import flag is (still) true but the
    #     structural precondition for import can never be met are rejected.
    # -----------------------------------------------------------------------
    _base_model_keys = {
        key for key, d in defs.items()
        if isinstance(d, dict)
        and not key.endswith('_detail') and not key.endswith('_input')
        and (d.get('properties') or {}).get('id') is not None
    }

    def _resolved_model_name(d: dict) -> str | None:
        """Mirrors generate_types.py's extract_entities() model-name resolution
        (allOf $ref → a base model), without that function's cross-entity
        child/m2m validation — this check only needs model identity."""
        for item in d.get('allOf', []) or []:
            ref = (item.get('$ref') or '').split('/')[-1]
            if ref in _base_model_keys:
                return ref
        return None

    for _model_key, _model_defn in defs.items():
        if not _SNAKE_CASE.match(_model_key) or _model_key not in _base_model_keys:
            continue
        _ik_raw = _model_defn.get('x-import-key') or []
        if not _ik_raw:
            continue

        # Find every definition generated *as this model* (parent == model —
        # i.e. `_model_key` itself or `{_model_key}_detail`, not an aliased
        # entity like 'setting' → 'user'), and collect whichever x-generate
        # block actually governs it (own block, else the base model's block —
        # same fallback chain as extract_entities()).
        _primary_gen_cfgs = []
        for _k, _d in defs.items():
            if not isinstance(_d, dict):
                continue
            _resolved = _resolved_model_name(_d)
            if _resolved is None and _k in _base_model_keys:
                _resolved = _k
            if _resolved != _model_key:
                continue
            _entity_name = _k[:-len('_detail')] if _k.endswith('_detail') else _k
            # _entity_name is never '__'-prefixed (only a '_detail' suffix is
            # ever stripped above), but _resolved is a base_model_keys entry —
            # '__'-prefixed under Stage 4 (cmd406-409). Strip that prefix
            # before comparing, or every Stage-4 primary view (e.g. 'user'
            # resolving to '__user') would wrongly be treated as an alias.
            _resolved_bare = _resolved[2:] if _resolved.startswith('__') else _resolved
            if _entity_name != _resolved_bare:
                continue  # alias entity (parent != model) — never import-eligible
            _gen_cfg = (
                _d.get('x-generate')
                or (_k.endswith('_detail') and defs.get(_resolved, {}).get('x-generate'))
                or (_k in _base_model_keys and defs.get(_k, {}).get('x-generate'))
            )
            if _gen_cfg:
                _primary_gen_cfgs.append(_gen_cfg)

        _eligible = any(
            (cfg.get('import', True) is not False)
            and (cfg.get('new', True) is not False or cfg.get('edit', True) is not False)
            for cfg in _primary_gen_cfgs
        )
        if _eligible:
            continue
        _import_explicitly_off = bool(_primary_gen_cfgs) and all(
            cfg.get('import', True) is False for cfg in _primary_gen_cfgs
        )
        if _import_explicitly_off:
            continue  # sanctioned export/dotted-FK-target-only opt-out

        if not _primary_gen_cfgs:
            _reason = (
                f"'{_model_key}' is never generated as a primary entity of its "
                f"own model (no '{_model_key}' or '{_model_key}_detail' "
                f"definition carries an x-generate block) — there is no create "
                f"or edit route to receive imported rows"
            )
        else:
            _reason = (
                f"'{_model_key}'s primary x-generate configuration has both "
                f"'new' and 'edit' disabled — there is no create or edit route "
                f"to receive imported rows"
            )
        errors.append(
            f"Definition '{_model_key}' (E_IMPORT_KEY_NOT_ELIGIBLE): declares "
            f"x-import-key {_ik_raw!r} with import left enabled (x-generate."
            f"import is not false), but {_reason}. Fix by either (a) making "
            f"'{_model_key}' a primary create-or-edit-able entity (add/adjust "
            f"a '{_model_key}_detail' x-generate block with new: true or "
            f"edit: true), or (b) if x-import-key is only needed for CSV "
            f"export / as a dotted-FK natural-key target for other entities, "
            f"set x-generate.import: false on '{_model_key}' to make the "
            f"opt-out explicit."
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
