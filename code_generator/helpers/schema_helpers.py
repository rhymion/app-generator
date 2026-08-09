"""Schema navigation utilities — port of helpers/schema-helpers.ts"""

import re

_DATE_FORMATS = frozenset({'date', 'date-time', 'time'})
_SYSTEM_FIELDS = frozenset({'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'})


def is_string_prop(prop: dict) -> bool:
    t = prop.get('type')
    if isinstance(t, str):
        return t == 'string'
    if isinstance(t, list):
        return 'string' in t and all(v in ('string', 'null') for v in t)
    return False


def derive_text_fields(properties: dict) -> list[str]:
    """Auto-derive searchable text fields from entity properties.

    Excludes noise (id, FK, enum, CUID pattern, date/uri format, write-only)
    and per-field opt-outs (x-search: false). Shared by the pg_trgm/pg_bigm
    full-text search context (generate.py) and the per-entity
    searchXxxOptions autocomplete filter (build_context.py) so both derive
    the same set of human-readable text columns from a single rule.
    """
    result = []
    for field_name, prop in properties.items():
        if not isinstance(prop, dict):
            continue
        if not is_string_prop(prop):
            continue
        # id and explicit primary key
        if field_name == 'id' or prop.get('x-primary'):
            continue
        # FK fields: x-relationship annotation or *_id naming convention
        if prop.get('x-relationship') or field_name.endswith('_id'):
            continue
        # enum values (integer or string)
        if isinstance(prop.get('enum'), list):
            continue
        # CUID/ID pattern strings
        pattern = prop.get('pattern', '')
        if pattern and re.search(r'\^c\[a-z0-9\]', pattern):
            continue
        # Non-text formats
        if prop.get('format') in ('date', 'date-time', 'time', 'uri'):
            continue
        # Write-only fields (e.g. password, api_key)
        xc = prop.get('x-custom-component', {})
        if isinstance(xc, dict) and 'upsert' in (xc.get('target') or []):
            continue
        # Per-field opt-out
        if prop.get('x-search') is False:
            continue
        result.append(field_name)
    return result


def _label_field_paths(label_field) -> list[str]:
    if isinstance(label_field, str):
        return [label_field] if label_field else []
    if isinstance(label_field, list):
        return [str(p) for p in label_field if p]
    return []


def derive_searchable_relation_fields(properties: dict, schema: dict) -> list[dict]:
    """FK relation fields whose `x-relationship.labelField` resolves to a
    searchable string field on the target entity, opted into cross-relation
    substring search for the generated searchXxxOptions getter (a one-hop
    Prisma nested `where`, e.g. inventory matching by its product's name).

    Reads `labelField` — the SAME source `build_label_expression()` uses for
    the CSV-import full-match (cmd_548) and for the label rendered on
    screen — rather than a separate `searchField` attribute. There used to
    be a `searchField`, declared independently on the FK; it was retired
    (cmd_552) because nothing stopped it from drifting away from
    `labelField`, at which point the field shown to the user and the field
    actually searched would silently differ. Deriving from `labelField`
    makes that divergence structurally impossible. Any schema still
    declaring `searchField` is now a validation error — see validate.py.

    A composite `labelField` ([f1, f2]) is evaluated element by element —
    each qualifying element contributes its own `{relation, field}` entry.
    Two kinds of element are excluded:
      - dotted paths (`approver_role.name`): resolving the FK's *own*
        FK to another entity would need a second nested `where` hop, which
        getters.ts.jinja2 does not render (one-hop only; no schema case
        needs it today — see docs/knowledge/label-field-search-semantics.md).
      - non-string-searchable fields: same filter as `derive_text_fields`
        (string type, no `enum`, not a date/uri `format`, not a CUID-pattern
        id) — `contains` is a string-only Prisma operator, and an enum's
        screen label is translated while its stored value is not, so a
        substring match against the raw value would never hit (cmd_493).
    """
    result = []
    for field_name, prop in properties.items():
        if not isinstance(prop, dict):
            continue
        rel = prop.get('x-relationship') or {}
        target = rel.get('target')
        label_field = rel.get('labelField')
        if not target or not label_field:
            continue
        relation_name = field_name.removesuffix('_id') if field_name.endswith('_id') else field_name
        target_props = get_entity_properties(target, schema)
        for path in _label_field_paths(label_field):
            if '.' in path:
                continue
            final_prop = target_props.get(path)
            if not isinstance(final_prop, dict):
                continue
            if not is_string_prop(final_prop):
                continue
            if isinstance(final_prop.get('enum'), list):
                continue
            if final_prop.get('format') in ('date', 'date-time', 'time', 'uri'):
                continue
            pattern = final_prop.get('pattern', '')
            if pattern and re.search(r'\^c\[a-z0-9\]', pattern):
                continue
            result.append({'relation': relation_name, 'field': path})
    return result


def derive_cross_entity_searchable_fields(entity_name: str, schema: dict) -> list[dict]:
    """Additional `{relation, field}` entries for entity_name's own
    searchXxxOptions(), sourced from OTHER entities' composite `labelField`
    declarations that reference entity_name through one of entity_name's OWN
    relations (cmd_627: e.g. goods_receipt_line.inventory_id declares
    `labelField: [item.sku, location.code, ...]` — the `location.code`
    segment is a dotted path relative to goods_receipt_line, but only ONE
    hop relative to inventory itself, since `location` is one of inventory's
    own FK relations).

    `derive_searchable_relation_fields()` only looks at entity_name's OWN
    `fields` block, so it never sees this: nothing on inventory itself
    declares `location.code` anywhere — the declaration lives entirely on
    the *referencing* entity (goods_receipt_line). Without this pass, the
    Cypress test-fixture generator (`build_string_only_label_expression`,
    used by generators_test.py to compute what a test TYPES into the
    autocomplete) and the runtime search generator
    (`derive_searchable_relation_fields`, used by build_context.py to
    compute what searchXxxOptions() actually QUERIES) can silently
    disagree — the exact drift `labelField`-sourcing (cmd_552) was meant to
    make structurally impossible, just one hop further out than that fix
    reached. See docs/knowledge/label-field-search-semantics.md, which
    documented this exact case as "no schema case needs it today" — proj_g's
    goods_receipt_line/approval_flow now do.

    Purely additive: only ever widens the OR-list of a search's per-token
    match — existing searchable fields and their behavior are unchanged.
    """
    own_props = get_entity_properties(entity_name, schema)
    own_relations: dict[str, str] = {}
    for prop_name, prop in own_props.items():
        if not isinstance(prop, dict) or not prop_name.endswith('_id'):
            continue
        rel = prop.get('x-relationship') or {}
        target = rel.get('target')
        if not target:
            continue
        own_relations[prop_name.removesuffix('_id')] = target

    result = []
    seen = set()
    for other_entity, other_def in schema.get('definitions', {}).items():
        # NOTE: self-reference (other_entity == entity_name) is intentionally
        # NOT skipped — a self-ref m2m (e.g. approval_flow.preceded_by
        # targeting approval_flow itself) is exactly the case this exists
        # for, and it's never covered by derive_searchable_relation_fields
        # (which only looks at entity_name's OWN fields with a non-dotted
        # labelField).
        if not isinstance(other_def, dict):
            continue
        for prop_name, prop in (other_def.get('properties') or {}).items():
            if not isinstance(prop, dict):
                continue
            rel = prop.get('x-relationship') or {}
            if rel.get('target') != entity_name:
                continue
            for path in _label_field_paths(rel.get('labelField')):
                if '.' not in path:
                    continue
                relation_name, _, final_field = path.partition('.')
                if relation_name not in own_relations or (relation_name, final_field) in seen:
                    continue
                nested_target = own_relations[relation_name]
                final_prop = get_entity_properties(nested_target, schema).get(final_field)
                if not isinstance(final_prop, dict) or not is_string_prop(final_prop):
                    continue
                if isinstance(final_prop.get('enum'), list):
                    continue
                if final_prop.get('format') in ('date', 'date-time', 'time', 'uri'):
                    continue
                pattern = final_prop.get('pattern', '')
                if pattern and re.search(r'\^c\[a-z0-9\]', pattern):
                    continue
                seen.add((relation_name, final_field))
                result.append({'relation': relation_name, 'field': final_field})
    return result


def _get_entity_base_props(entity: str, schema: dict) -> dict:
    """Returns the base (raw-entity) properties for an entity, resolving allOf if needed.

    A view entity (`role`) has no properties of its own — its allOf[0] $ref
    points at the raw entity (`__role`) that actually carries them. Most
    chains are one hop, but a proxy view like `setting` (allOf $ref -> the
    `user` VIEW, not `__user`) is two hops, so this walks the $ref chain
    until it lands on a definition with direct properties rather than
    resolving only one level.
    """
    defn = schema['definitions'].get(entity, {})
    seen = set()
    while 'properties' not in defn:
        ref = next((item.get('$ref') for item in defn.get('allOf', []) if item.get('$ref')), None)
        if not ref or ref in seen:
            return {}
        seen.add(ref)
        defn = schema['definitions'].get(ref.split('/')[-1], {})
    return defn['properties']


def _label_field_is_date(label_field, target: str, schema: dict) -> bool:
    """Returns True if the label_field's first path resolves to a date/time field.

    `label_field` may be a single field name, a dotted path through outbound
    m2o / one-to-one relations, or a list of either. For the legacy callers
    that gate downstream behaviour on a single boolean (e.g. test helpers
    reading `dep.label_field_is_date`), True is returned when the FIRST path
    in the labelField ends on a date/time field.
    """
    # Local import to avoid a circular dependency between this module and
    # label_field — the label_field helper imports nothing from here.
    from helpers.label_field import first_label_format
    return first_label_format(label_field, target, schema) in _DATE_FORMATS


def get_detail_properties(parent: str, schema: dict, detail_key: str | None = None) -> dict | None:
    key = detail_key or parent
    defn = schema['definitions'].get(key)
    if not defn:
        return None
    if 'properties' in defn:
        return defn['properties']
    for item in defn.get('allOf', []):
        if 'properties' in item:
            return item['properties']
    return None


def get_approval_lines_props(parent_def: dict, model: str, schema: dict) -> list[str]:
    """Embedded-line properties whose approvable_id must be pre-created before
    the parent create/update (nested-create can't back-fill a NOT NULL FK).

    Two independent schema signals feed this, and both need identical
    treatment (see docs/receiving-approval-backfill-design.md §5.2 — D2):
    - explicit `x-approval-lines: [prop, ...]` (e.g. receiving_receipt.lines)
    - `x-reservation` with `transaction.strategy: ledger_transaction` whose
      *lines entity itself declares `x-approval`* (e.g. purchase_order.items
      -> purchase_per_item) — its lines carry their own approvable per-line
      just like x-approval-lines children, so they're folded into the same
      list rather than duplicating the pre-create/post-create machinery.

      The x-approval gate matters: ledger_transaction is also used (in tests,
      and potentially future schemas) for reservation lines that carry no
      approval at all — those must NOT get approvable_id injected into a
      nested-create/update body that has no such column.
    """
    props = list(parent_def.get('x-approval-lines') or [])
    xres = parent_def.get('x-reservation') or {}
    if (xres.get('transaction') or {}).get('strategy') == 'ledger_transaction':
        lines_prop = xres.get('lines')
        if lines_prop and lines_prop not in props:
            detail_props = get_detail_properties(model, schema) or {}
            ref = ((detail_props.get(lines_prop) or {}).get('items') or {}).get('$ref', '')
            lines_entity = ref.rsplit('/', 1)[-1]
            if lines_entity and (schema.get('definitions', {}).get(lines_entity) or {}).get('x-approval'):
                props.append(lines_prop)
    return props


def get_self_only_flags(entity_def: dict) -> tuple[bool, bool]:
    """Resolve an entity's `x-self-only` declaration to (is_self_only, admin_bypass).

    Accepts both the shorthand (`x-self-only: true`) and the explicit dict
    form (`x-self-only: {admin_bypass: true}`). The shorthand's admin_bypass
    always defaults to False: the loose/permissive direction must never be
    the implicit default, so a schema reader can tell who can see a
    self-only entity's rows without checking elsewhere.
    """
    x_self_only = entity_def.get('x-self-only')
    if x_self_only is True:
        return True, False
    if isinstance(x_self_only, dict):
        return True, bool(x_self_only.get('admin_bypass', False))
    return False, False


def get_splittable_bridge_field(entity_def: dict) -> str:
    """The property name on an x-splittable entity that holds its per-child
    ledger/reservation bridge FK (e.g. purchase_per_item / receiving_receipt_line's
    inventory_transactionable_id).

    Config-driven via x-splittable.bridgeField, defaulting to
    'inventory_transactionable_id' — the two current x-splittable entities
    reach this field through different parent-side mechanisms (purchase_order's
    x-reservation.transaction.strategy: ledger_transaction vs. receiving_receipt's
    plain x-approval-lines + receiving_receipt_line's own x-ledger-source), so
    there is no single reverse lookup that resolves it for both; the entity's
    own x-splittable config is the one place both agree to declare it (cmd_312
    Phase1; see docs/knowledge/schema-yaml-configuration.md for background).
    """
    split_cfg = entity_def.get('x-splittable')
    split_dict = split_cfg if isinstance(split_cfg, dict) else {}
    return split_dict.get('bridgeField', 'inventory_transactionable_id')


def resolve_ledger_domain(schema: dict, domain_key: str) -> dict:
    """Resolve x-ledger-entities[domain_key] to
    {pool, ledger, transactionable, item_field, location_field,
    lot_field, expiration_field}.

    OD-1 underlying idea: config required, no defaults. Raises ValueError if
    the domain or any of its required keys is not declared in the schema.

    item_field/location_field/lot_field/expiration_field are the pool
    entity's own column names for its item-master FK, location FK, lot
    number, and expiration date (e.g. 'product_id', 'location_id',
    'lot_number', 'expiration_date'). cmd_546: previously these were
    hardcoded literals throughout generators.py and the ledger_* stub /
    split_action_route templates, which silently broke (no error) for any
    consumer naming these columns differently (e.g. one consumer's
    item-master FK is named 'product_id' as a workaround specifically
    because it was hardcoded here). The ledger entity's own columns reuse
    these same names (current consumer schemas declare them identically on
    both sides; no consumer has ever diverged the two).

    cmd_562: location_field is now an id-FK on *both* the pool and the
    ledger entity (matching item_field's existing shape) — the ledger row
    write is a plain id copy (`ledger.location_id = pool.location_id`), not
    a denormalized display-string snapshot. This resolver previously also
    derived location_relation (the Prisma relation accessor, e.g.
    'location_id' -> 'location') and location_label_field/
    location_label_target (the pool entity's x-relationship.labelField/
    .target on location_field) so the ledger stub / split-route templates
    could render a `.name`-equivalent snapshot string and later reverse-look
    -up that string back to a location row. None of that machinery is
    needed once the ledger column is an id itself: there is no display
    string to render and no reverse lookup to invert. PR #269 (cmd_550)
    built exactly that machinery to fix the previous hardcoded-`.name`
    plain-string design; cmd_562 removes both the old bug and the fix
    wholesale in favor of the strictly simpler id-FK design (see
    docs/knowledge/appendix/inventory-reservation-split.md).
    """
    domains = schema.get('x-ledger-entities') or {}
    if domain_key not in domains:
        raise ValueError(f"x-ledger-entities.{domain_key!r} not declared in schema")
    domain = domains[domain_key]
    for required_key in (
        'pool', 'ledger', 'transactionable',
        'itemField', 'locationField', 'lotField', 'expirationField',
    ):
        if required_key not in domain:
            raise ValueError(f"x-ledger-entities.{domain_key!r}.{required_key!r} is required")
    return {
        'pool': domain['pool'],
        'ledger': domain['ledger'],
        'transactionable': domain['transactionable'],
        'item_field': domain['itemField'],
        'location_field': domain['locationField'],
        'lot_field': domain['lotField'],
        'expiration_field': domain['expirationField'],
    }


def get_detail_relation_name(parent: str, target: str, schema: dict, detail_key: str | None = None) -> str:
    """Resolves the property name that $ref-s to `target` in the detail definition.
    e.g. for target='organization', finds 'organization' property with $ref: '#/definitions/organization'
    Falls back to target name if not found."""
    properties = get_detail_properties(parent, schema, detail_key)
    if not properties:
        return target
    for prop_name, prop in properties.items():
        ref = prop.get('$ref', '')
        if ref and ref.split('/')[-1] == target:
            return prop_name
    return target


def filter_fields(properties: dict, fields: list[str] | None = None) -> dict:
    """If fields whitelist is given, keep only those + id/timestamps. Otherwise return all."""
    if not fields:
        return properties
    allowed = set(fields) | {'id', 'created_at', 'updated_at', 'creator_id'}
    return {k: v for k, v in properties.items() if k in allowed}


def is_optional_fk_to_parent(child_def: dict, parent_model: str) -> bool:
    """Return True if the child's structural FK to parent_model is nullable.

    Uses get_parent_fk_props to find the actual parent FK column (convention-first),
    so a secondary x-relationship FK pointing to the same entity is not confused
    with the structural parent link.
    """
    fk_props = get_parent_fk_props(child_def, parent_model)
    props = child_def.get('properties', {})
    for fk_prop in fk_props:
        prop_def = props.get(fk_prop)
        if prop_def is not None:
            t = prop_def.get('type')
            return isinstance(t, list) and 'null' in t
    return False  # FK not found or not nullable → treat as mandatory


def get_parent_fk_props(child_def: dict, parent_model: str) -> set[str]:
    """Find the FK property (or properties) in child_def that represent the structural
    parent-to-child link — i.e. the column the parent uses to own/embed this child.

    Priority:
    1. The conventional '{parent_model}_id' field, if it exists on the child.
       This is the Prisma-style implicit FK and is often NOT annotated with
       x-relationship (which is reserved for additional relationship dropdowns).
    2. Fallback: scan x-relationship annotations for target == parent_model.
       Used when the child genuinely uses a non-conventional FK name.
    3. Last resort: return {'{parent_model}_id'} as the assumed convention even if
       the field was not found (preserves old behaviour for schema edge cases).

    NOTE: do NOT return x-relationship FKs when the conventional field already
    exists — a field like 'reference_id' may point to the same parent entity for
    a different purpose and must not be treated as the structural parent FK.
    """
    props = child_def.get('properties', {})
    convention = f'{parent_model}_id'
    if convention in props:
        return {convention}
    # Conventional field absent — scan for an annotated FK to this parent
    found = {
        prop_name
        for prop_name, prop in props.items()
        if (prop.get('x-relationship') or {}).get('target') == parent_model
    }
    return found or {convention}


def get_one_to_one_rels(parent_def: dict, schema: dict) -> list[dict]:
    """Returns outbound one-to-one FK relationship metadata (FK is on this model).

    Recognises two relation types and tags each entry accordingly:
      - 'one-to-one'        → selector OTO (target has own pages, picker UI)
      - 'one-to-one_bridge' → bridge OTO (target auto-created alongside parent,
                              e.g. approvable/commentable; no picker)

    Each entry: {prop_name, relation_name, target, label_field, relation_type,
                 is_selector, nullable, children}.
    'children' = array children of the target's _detail (for nested includes
    and display) — only populated for bridge OTO.
    'is_selector' = True for 'one-to-one', False for 'one-to-one_bridge';
    kept as a convenience so existing callers don't need to switch on the type
    string everywhere.
    'nullable' = True when the FK field itself is nullable."""
    props = parent_def.get('properties', {})
    result = []
    for prop_name, prop in props.items():
        rel = prop.get('x-relationship')
        if not rel or not rel.get('target'):
            continue
        relation_type = rel.get('type')
        if relation_type not in ('one-to-one', 'one-to-one_bridge'):
            continue
        target = rel['target']
        relation_name = prop_name[:-3] if prop_name.endswith('_id') else prop_name
        label_field = rel.get('labelField', 'name')

        is_selector = relation_type == 'one-to-one'

        # Determine if FK is nullable
        prop_type = prop.get('type')
        nullable = isinstance(prop_type, list) and 'null' in prop_type

        # Collect array children from the target's _detail definition (only for bridge OTO).
        # Selector OTO has no nested children rendered through this list — its target has its
        # own pages and uses regular m2o/list rendering.
        children = []
        if not is_selector:
            target_detail = schema['definitions'].get(target, {})
            target_detail_props = {}
            if 'properties' in target_detail:
                target_detail_props = target_detail['properties']
            else:
                for item in target_detail.get('allOf', []):
                    if 'properties' in item:
                        target_detail_props = item['properties']
                        break
            for cp_name, cp in target_detail_props.items():
                if cp.get('type') == 'array' and (cp.get('items') or {}).get('$ref'):
                    child_name = cp['items']['$ref'].split('/')[-1]
                    child_def = schema['definitions'].get(child_name, {})
                    child_rels = get_parent_relationships(child_def)
                    children.append({
                        'property_name': cp_name,
                        'child_name': child_name,
                        'child_rels': child_rels,
                        'child_def': child_def,
                    })

        result.append({
            'prop_name': prop_name,
            'relation_name': relation_name,
            'target': target,
            'label_field': label_field,
            'label_field_is_date': _label_field_is_date(label_field, target, schema),
            'relation_type': relation_type,
            'is_selector': is_selector,
            'nullable': nullable,
            'children': children,
        })
    return result


def get_internal_bridge_fk_prop_names(parent_def: dict, schema: dict) -> set[str]:
    """Returns FK property names on parent_def that point at an internal bridge
    model (e.g. approvable, commentable, attachable, inventory_transactionable)
    — server-managed plumbing with no client-visible generation surface, never
    a real user-facing relation despite existing as a physical FK column.

    Two shapes exist in this schema, and neither is visible to
    get_parent_relationships() / get_one_to_one_rels() on its own — both
    require x-relationship with a recognised type, which is exactly what
    these FKs lack or use differently (cmd_420):
      (a) x-relationship.type == 'one-to-one_bridge' (e.g. approvable_id) —
          excluded from get_parent_relationships() by relation type; only
          get_one_to_one_rels() sees it, and only under its own prop_name key.
      (b) no x-relationship at all (e.g. inventory_transactionable_id,
          "bridge created at approval time by ledger_move_stub") — invisible
          to every relationship-aware helper.

    Detection is by structural signal, not by field name: a `<x>_id` property
    targets an internal bridge only when `<x>` (and every `<x>_*` schema
    variant, e.g. `<x>_detail`) carries zero true x-generate flags — i.e. the
    target has no list/view/new/edit/delete/api surface anywhere. This is what
    separates a true internal bridge from an ordinary FK that merely omits
    x-relationship for unrelated reasons (e.g. field.db_table_id, where
    db_table is a fully exposed, independently generated entity).

    Callers that build an FK-exclusion set (CSV export allowlist, form field
    filtering, etc.) should union this into whatever get_parent_relationships()
    already gives them.
    """
    props = parent_def.get('properties', {})
    defs = schema.get('definitions', {})

    def _is_internal_bridge_entity(name: str) -> bool:
        variants = [name] + [n for n in defs if n.startswith(f'{name}_')]
        for v in variants:
            gen = (defs.get(v, {}) or {}).get('x-generate') or {}
            if any(gen.get(k) for k in ('list', 'view', 'new', 'edit', 'delete', 'api')):
                return False
        return True

    result = set()
    for prop_name, prop in props.items():
        if not isinstance(prop, dict) or not prop_name.endswith('_id'):
            continue
        rel = prop.get('x-relationship')
        if rel:
            if rel.get('type') != 'one-to-one_bridge':
                continue
            target = rel.get('target')
        else:
            target = prop_name[:-3]
        if not target or target not in defs:
            continue
        if _is_internal_bridge_entity(target):
            result.add(prop_name)
    return result


def _get_first_label_field(target: str, schema: dict) -> str:
    """Returns the first non-id/non-timestamp/non-fk simple field of target entity."""
    _SKIP = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'}
    props = _get_entity_base_props(target, schema)
    for field_name, prop in props.items():
        if field_name in _SKIP or field_name.endswith('_id'):
            continue
        prop_type = prop.get('type')
        if isinstance(prop_type, list):
            prop_type = next((t for t in prop_type if t != 'null'), None)
        if prop_type in ('string', 'integer', 'number', 'boolean'):
            return field_name
    return 'id'


def _extract_flatten_fields(target_props: dict, parent_model: str) -> list[dict]:
    """Extract field info for flatten accordion display.

    Excludes system fields and back-references to the parent. Arrays of
    `$ref` items are surfaced with `is_array: True` so the renderer can
    show them as a read-only list inline in the accordion (e.g., a
    `pre_check_detail.symptoms` array shown inside the `pre_check` section
    of `checkup`'s form).
    """
    fields = []
    for field_name, prop in target_props.items():
        if field_name in _SYSTEM_FIELDS:
            continue
        prop_type = prop.get('type')

        # Array of $ref → render as a read-only list of item labels.
        if prop_type == 'array':
            items = prop.get('items', {}) if isinstance(prop.get('items'), dict) else {}
            ref = items.get('$ref', '')
            if not ref:
                continue
            item_target = ref.split('/')[-1]
            fields.append({
                'name': field_name,
                'prop_type': 'array',
                'is_array': True,
                'item_target': item_target,
                'is_fk': False,
                'format': None,
                'nullable': True,
                'enum': None,
            })
            continue

        # Plain $ref to another entity (no `type`, no `x-relationship`).
        # In a *_detail extension, these typically point back at the parent
        # (e.g., pre_check_detail.checkup → "#/definitions/checkup") and
        # are self-evident in the parent's form. Skip them.
        if '$ref' in prop and not prop_type:
            ref_target = prop['$ref'].split('/')[-1]
            if ref_target == parent_model or ref_target == f'__{parent_model}':
                continue
            # Forward-reference to a different entity inside a detail
            # extension — out of scope for inline accordion rendering today.
            continue

        rel = prop.get('x-relationship')
        if rel:
            rel_target = rel.get('target', '')
            if rel_target == parent_model:
                continue  # back-reference to parent — skip
            if rel.get('type') in ('many-to-one', 'one-to-one'):
                nullable = isinstance(prop_type, list) and 'null' in prop_type
                fields.append({
                    'name': field_name,
                    'prop_type': 'string',
                    'format': None,
                    'nullable': nullable,
                    'enum': None,
                    'is_fk': True,
                    'fk_target': rel_target,
                    'fk_label_field': rel.get('labelField', 'name'),
                    'relation_name': field_name.removesuffix('_id'),
                })
                continue
        # Regular field
        nullable = False
        if isinstance(prop_type, list):
            nullable = 'null' in prop_type
            prop_type = next((t for t in prop_type if t != 'null'), 'string')
        fields.append({
            'name': field_name,
            'prop_type': prop_type or 'string',
            'format': prop.get('format'),
            'nullable': nullable,
            'enum': prop.get('enum') if isinstance(prop.get('enum'), list) else None,
            'is_fk': False,
            # Numeric bounds — needed downstream by cypress_create_value so the
            # generated test value respects the schema cap (e.g. lifestyle's
            # quolity_of_sleep has max: 10; emitting '100' would be clipped by
            # the BaseNumberField on input and break the post-save assertion).
            'minimum': prop.get('minimum'),
            'maximum': prop.get('maximum'),
        })
    return fields


def _merge_allof_properties(defn: dict, schema: dict) -> dict:
    """Recursively merge a definition's own properties with every allOf
    ancestor's properties (base first, so extensions shadow same-name base
    fields). Walks $ref chains of any depth — e.g. `setting` -> `user`
    (view, no properties of its own) -> `__user` (raw) is two hops, not
    the one hop every raw/view pair normally is."""
    if 'properties' in defn:
        return defn['properties']

    merged: dict = {}
    for item in defn.get('allOf', []):
        if '$ref' in item:
            ref_def = schema['definitions'].get(item['$ref'].split('/')[-1], {})
            merged = {**merged, **_merge_allof_properties(ref_def, schema)}
        elif 'properties' in item:
            merged = {**merged, **item['properties']}
    return merged


def _get_flatten_target_props(target: str, schema: dict) -> dict:
    """Return displayable properties for a flatten target.

    Plain entity (`pre_check`): returns `properties`.
    View entity (`pre_check` = allOf[raw $ref, {properties}]):
        returns the *merge* of the raw entity's properties and the view's
        own extension properties (recursively, through any indirection —
        see `_merge_allof_properties`) so flatten rendering sees both the
        inherited fields (e.g., `ams_score` from the raw entity) and the
        extension's added ones (e.g., `symptoms` array, `checkup` back-ref).

    Order in the merge: base first, then extension overrides — extension
    properties shadow same-name base properties, mirroring JSON Schema
    semantics for allOf merging.

    Compare with `_get_entity_base_props`, which only returns the raw
    ancestor's own properties (walks to the end of the chain, no merge).
    That helper has callers that *deliberately* want just the base — keep
    it; flatten uses this one.
    """
    defn = schema['definitions'].get(target, {})
    return _merge_allof_properties(defn, schema)


def get_entity_properties(entity: str, schema: dict) -> dict:
    """Public merged-properties lookup for any entity key (raw `__x` or view `x`).

    Thin wrapper around `_get_flatten_target_props` — cross-file callers (e.g.
    validate.py) that need "does entity E have field F" for a bare model name
    should use this rather than a direct `defs[E].get('properties', {})`,
    since a view entity (`role`) carries no properties of its own; its fields
    live on the raw entity (`__role`) referenced via allOf[0].$ref.
    """
    return _get_flatten_target_props(entity, schema)


def _merge_allof_required(defn: dict, schema: dict) -> set:
    """Recursive counterpart to `_merge_allof_properties` for the 'required' list —
    JSON Schema allOf semantics union every branch's required fields."""
    merged = set(defn.get('required') or [])
    for item in defn.get('allOf', []):
        if '$ref' in item:
            ref_def = schema['definitions'].get(item['$ref'].split('/')[-1], {})
            merged |= _merge_allof_required(ref_def, schema)
        else:
            merged |= set(item.get('required') or [])
    return merged


def get_entity_required(entity: str, schema: dict) -> set:
    """Public merged-required lookup for any entity key (raw `__x` or view `x`).
    See `get_entity_properties` — same raw/view resolution problem, for 'required'."""
    defn = schema['definitions'].get(entity, {})
    return _merge_allof_required(defn, schema)


def get_flatten_rels(parent: str, parent_def: dict, schema: dict) -> list[dict]:
    """Returns $ref properties from the _detail definition with x-outputType: flatten.

    These are rendered as collapsible accordion sections showing the target entity's fields
    inline in the detail view (read-only). Fields that back-reference the parent are excluded.
    Each entry: {prop_name, relation_name, target, is_m2o, fields}
    """
    detail_props = get_detail_properties(parent, schema)
    if not detail_props:
        return []

    base_props = parent_def.get('properties', {})
    result = []
    for prop_name, prop in detail_props.items():
        if prop.get('x-outputType') != 'flatten':
            continue
        ref = prop.get('$ref', '')
        if not ref or prop.get('type') == 'array':
            continue
        target = ref.split('/')[-1]
        relation_name = prop.get('x-relationName') or prop_name
        is_m2o = f'{prop_name}_id' in base_props
        # Use the merged (base + detail) properties so a `_detail` target
        # surfaces both inherited scalar fields (ams_score) and the
        # extension's additions (symptoms array).
        target_props = _get_flatten_target_props(target, schema)
        fields = _extract_flatten_fields(target_props, parent)
        result.append({
            'prop_name': prop_name,
            'relation_name': relation_name,
            'target': target,
            'is_m2o': is_m2o,
            'fields': fields,
        })
    return result


def get_detail_ref_rels(parent: str, parent_def: dict, schema: dict) -> list[dict]:
    """Returns reverse one-to-one relation metadata from a _detail definition.

    These are plain $ref properties in the {parent}_detail extension that have NO
    corresponding FK field in the base model (the FK lives in the target, pointing back).
    Properties with x-outputType: flatten are excluded (handled by get_flatten_rels).
    Each entry: {prop_name, target, label_field}
    """
    detail_props = get_detail_properties(parent, schema)
    if not detail_props:
        return []

    base_props = parent_def.get('properties', {})
    # Many-to-one relation names (derived from FK prop_name by stripping _id)
    m2o_relation_names = {
        r['prop_name'].removesuffix('_id')
        for r in get_parent_relationships(parent_def, schema)
    }
    # Outbound OTO FK prop names (FK is in this model)
    oto_fk_names = {r['prop_name'] for r in get_one_to_one_rels(parent_def, schema)}

    result = []
    for prop_name, prop in detail_props.items():
        ref = prop.get('$ref', '')
        if not ref or prop.get('type') == 'array':
            continue
        # flatten properties are handled separately by get_flatten_rels
        if prop.get('x-outputType') == 'flatten':
            continue
        target = ref.split('/')[-1]
        # Skip if base model has a corresponding FK for this relation
        if f'{prop_name}_id' in base_props:
            continue
        # Skip if already handled as a many-to-one (relation name matches)
        if prop_name in m2o_relation_names:
            continue
        # Skip if the corresponding FK is an outbound OTO
        if f'{prop_name}_id' in oto_fk_names:
            continue
        label_field = prop.get('x-labelField') or _get_first_label_field(target, schema)
        # x-relationName lets the YAML override the Prisma relation name when it differs
        # from the property name (e.g. checkup.judgement vs detail property checkup_judgment)
        relation_name = prop.get('x-relationName') or prop_name
        result.append({
            'prop_name': prop_name,
            'relation_name': relation_name,
            'target': target,
            'label_field': label_field,
            'label_field_is_date': _label_field_is_date(label_field, target, schema),
        })
    return result


def get_parent_relationships(parent_def: dict, schema: dict | None = None) -> list[dict]:
    """Returns selectable FK relationship metadata from a schema definition.
    Each entry: {prop_name, target, label_field, label_field_is_date, required}"""
    props = parent_def.get('properties', {})
    required = set(parent_def.get('required') or [])
    result = []
    for prop_name, prop in props.items():
        rel = prop.get('x-relationship')
        if not rel or rel.get('type') not in ('many-to-one', 'one-to-one') or not rel.get('target'):
            continue
        if prop_name == 'creator_id':
            continue
        target = rel['target']
        lf = rel.get('labelField', 'name')
        result.append({
            'prop_name': prop_name,
            'target': target,
            'label_field': lf,
            'label_field_is_date': _label_field_is_date(lf, target, schema) if schema else False,
            'required': prop_name in required,
            # DP-5 (cmd_377/379): scalar field names from *this* entity's own
            # form state to forward as `formValues` into the target's
            # search{Target}Options() autocomplete filter hook. Empty when the
            # FK field carries no 'x-autocomplete-context' annotation — the
            # unchanged (Phase-1) default.
            'autocomplete_context_fields': list(prop.get('x-autocomplete-context') or []),
        })
    return result


def find_fk_derivation_path(parent: str, parent_def: dict, target_q: str, schema: dict) -> dict | None:
    """Walk the parent's m2o/o2o FKs to find a way to derive a value of target_q's id.

    Used by the service generator when a flatten OTO target carries an external
    required FK (e.g. lifestyle has required `patient_id` while it lives flatten-
    inside `checkup`). The form does not ask the user for that FK — instead the
    service must derive it from data the parent already has.

    Walk depth = 2 (direct + one hop):
      * direct  : parent has its own m2o/o2o FK pointing to `target_q`.
      * one_hop : parent has FK to entity X, and X has a m2o/o2o FK to `target_q`.

    Returns dict {kind, parent_fk, parent_fk_var, intermediate, intermediate_fk}
    or None if no path exists. The caller emits the appropriate Prisma query
    against the resolved path.
    """
    parent_rels = get_parent_relationships(parent_def, schema)

    # Direct path — parent itself has an FK to target_q.
    for rel in parent_rels:
        if rel['target'] == target_q:
            return {
                'kind': 'direct',
                'parent_fk': rel['prop_name'],
                'intermediate': None,
                'intermediate_fk': None,
            }

    # One-hop path — parent → X → target_q. rel['target'] is the bare/view
    # name; its m2o/o2o FK annotations live on the raw entity.
    for rel in parent_rels:
        x_def = (
            schema['definitions'].get(f"__{rel['target']}", {})
            or schema['definitions'].get(rel['target'], {})
        )
        if not x_def:
            continue
        for x_rel in get_parent_relationships(x_def, schema):
            if x_rel['target'] == target_q:
                return {
                    'kind': 'one_hop',
                    'parent_fk': rel['prop_name'],
                    'intermediate': rel['target'],
                    'intermediate_fk': x_rel['prop_name'],
                }

    return None
