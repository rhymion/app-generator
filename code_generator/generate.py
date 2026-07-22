#!/usr/bin/env python3
"""
generate.py — Full Python code generator (replaces generate.ts + templates.ts).

Usage:
    cd code_generator/py
    python generate.py ../../json_schema_db_table.yaml ../../

This is a drop-in replacement for:
    npx tsx code_generator/generate.ts <schema.yaml> .

"""
import json
import re
import sys
import os
from pathlib import Path
from dataclasses import asdict

import yaml
from jinja2 import Environment, FileSystemLoader

from helpers.naming import to_pascal_case, to_camel_case
from helpers.bridge_direction import get_new_form_bridge
from helpers.bridge_prisma import emit_bridge_model, emit_parent_bridge_fk, emit_child_bridge_fk
from helpers.schema_helpers import get_flatten_rels
from generate_types import extract_entities, extract_named_constants
from context import build_entity_context
from build_context import build_context, build_anonymize_user_context, _get_actual_type
from helpers.label_field import build_label_expression
from helpers.schema_helpers import derive_text_fields as _derive_text_fields
from helpers.schema_helpers import get_splittable_bridge_field
from helpers.schema_helpers import resolve_ledger_domain
from helpers.schema_helpers import get_entity_properties
from generators import (
    chart_context,
    page_list_context,
    actions_context,
    service_context,
    column_def_context,
    form_view_context,
    form_upsert_context,
    build_dashboard_catalog,
    build_attachable_owners,
    get_reservation_action_routes,
    _build_approval_create_block_for_entity,
)
from generators_i18n import update_i18n_and_config
from validate import validate_schema, validate_prisma_indexes, SchemaValidationError
from generators_doc import build_doc_entity_context, build_doc_index_context, convert_md_to_mdx
from generators_test import (
    helper_context,
    spec_context,
    tasks_registry_context,
    api_spec_context,
    db_helpers_context,
    reservation_helper_context,
    reservation_spec_context,
    set_messages_fields,
    set_messages_namespaces,
)
from validation_context import build_validation_context
from manifest import ManifestRecorder, sha256_file, sha256_text


# ---------------------------------------------------------------------------
# Jinja2 environment
# ---------------------------------------------------------------------------

def _make_env() -> Environment:
    here = Path(__file__).parent
    env = Environment(
        loader=FileSystemLoader(here / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    env.filters['tojson'] = json.dumps
    return env


# ---------------------------------------------------------------------------
# Bridge Prisma schema emission
# ---------------------------------------------------------------------------

def _collect_bridges(schema: dict) -> dict[str, dict]:
    """Collect all new-form x-bridge object declarations from the schema."""
    defs = schema.get('definitions', {})
    bridges: dict[str, dict] = {}
    for entity_name, entity_def in defs.items():
        if not entity_name.startswith('__') or not isinstance(entity_def, dict):
            continue
        bridge = get_new_form_bridge(entity_def)
        if bridge:
            bridges[bridge['name']] = bridge
    return bridges


def build_bridge_prisma_additions(schema: dict) -> str:
    """Generate Prisma model additions for all new-form FK-on-parent bridge models.

    Returns a Prisma-compatible string block with bridge model blocks and FK comment
    lines documenting required parent/child additions. Used as reference documentation
    (bridge_additions.prisma). The actual injection into schema.prisma is done by
    inject_bridge_into_schema().
    """
    bridges = _collect_bridges(schema)
    if not bridges:
        return ''

    blocks: list[str] = []
    for bridge_name, bridge in sorted(bridges.items()):
        child = bridge['child']
        parent_targets = bridge['parent_targets']

        blocks.append(emit_bridge_model(bridge_name, child, parent_targets))

        for parent in parent_targets:
            scalar, relation = emit_parent_bridge_fk(bridge_name, parent)
            blocks.append(f'// [parent:{parent}] {scalar.strip()}')
            blocks.append(f'// [parent:{parent}] {relation.strip()}')

        child_scalar, child_relation = emit_child_bridge_fk(bridge_name)
        blocks.append(f'// [child:{child}] {child_scalar.strip()}')
        blocks.append(f'// [child:{child}] {child_relation.strip()}')

    return '\n\n'.join(blocks)


def _inject_into_model_block(content: str, model_name: str,
                              scalar_line: str, relation_line: str,
                              fk_field_name: str) -> str:
    """Inject FK scalar+relation lines into a Prisma model block (idempotent)."""
    pat = re.compile(
        rf'^(model {re.escape(model_name)} \{{)(.*?)(^\}})',
        re.MULTILINE | re.DOTALL,
    )
    m = pat.search(content)
    if not m:
        return content

    body = m.group(2)
    if re.search(rf'^\s+{re.escape(fk_field_name)}\b', body, re.MULTILINE):
        return content  # field already present — idempotent

    lines = body.split('\n')
    insert_before = len(lines)
    for i, line in enumerate(lines):
        if line.strip().startswith('@@'):
            insert_before = i
            break

    new_body = '\n'.join(lines[:insert_before] + [scalar_line, relation_line, ''] + lines[insert_before:])
    return content[:m.start(2)] + new_body + content[m.end(2):]


def _inject_index_into_model_block(content: str, model_name: str, fk_col: str) -> str:
    """Ensure `@@index([fk_col])` exists in a Prisma model block (idempotent).

    Needed for the child-side bridge FK (e.g. `commentable_id` on `comment`),
    which has no `@unique` (unlike the parent-side FK) and so gets no implicit
    index from Prisma/Postgres — see docs/knowledge/prisma-schema-conventions.md.
    """
    pat = re.compile(
        rf'^(model {re.escape(model_name)} \{{)(.*?)(^\}})',
        re.MULTILINE | re.DOTALL,
    )
    m = pat.search(content)
    if not m:
        return content

    body = m.group(2)
    for decl in re.findall(r'@@index\(\s*\[([^\]]+)\]', body):
        if decl.split(',', 1)[0].strip() == fk_col:
            return content  # already indexed — idempotent

    new_body = body.rstrip('\n') + f'\n  @@index([{fk_col}])\n'
    return content[:m.start(2)] + new_body + content[m.end(2):]


def inject_bridge_into_schema(schema_prisma_path: Path, bridges: dict) -> None:
    """Inject bridge models and parent/child FK fields into schema.prisma (idempotent).

    For each bridge:
      1. Injects parent FK scalar + relation into each parent model
      2. Injects child FK scalar + relation into the child model
      3. Appends the bridge model block at the end if not already present
    """
    content = schema_prisma_path.read_text()
    modified = content

    for bridge_name, bridge in sorted(bridges.items()):
        child = bridge['child']
        parent_targets = bridge['parent_targets']

        for parent_name in parent_targets:
            scalar, relation = emit_parent_bridge_fk(bridge_name, parent_name)
            modified = _inject_into_model_block(
                modified, parent_name, scalar, relation, f'{bridge_name}_id'
            )

        child_scalar, child_relation = emit_child_bridge_fk(bridge_name)
        modified = _inject_into_model_block(
            modified, child, child_scalar, child_relation, f'{bridge_name}_id'
        )
        modified = _inject_index_into_model_block(modified, child, f'{bridge_name}_id')

        if f'model {bridge_name} {{' not in modified:
            bridge_block = emit_bridge_model(bridge_name, child, parent_targets)
            modified = modified.rstrip('\n') + f'\n\n{bridge_block}\n'

    if modified != content:
        schema_prisma_path.write_text(modified)
        print(f'  Injected bridge models/FKs → prisma/schema.prisma')


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

def _render(env: Environment, template_name: str, ctx: dict) -> str:
    tmpl = env.get_template(template_name)
    return tmpl.render(**ctx)


# Records every generated file for this run; reset at the top of generate().
_manifest = ManifestRecorder()


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
    _manifest.record(path, content, 'overwrite')
    print(f'  Wrote {path}')


def _write_stub(path: Path, content: str) -> None:
    """Write stub only if file does not already exist (user may have customized).

    Exception (cmd_413b): if the existing file's content matches a *past*
    pristine render of this same stub (recorded across manifest runs — see
    ManifestRecorder.is_stale_stub), it was never hand-edited — it was just
    left behind by an earlier run before the schema grew a signal (e.g.
    x-approval / an approvable relation) that changes what this stub should
    contain. That case self-heals: we refresh it with today's render instead
    of skipping it forever.
    """
    # Record the pristine stub content whether or not we (re)write it, so cleanup
    # can delete the file iff it still matches a pristine stub (i.e. untouched).
    _manifest.record(path, content, 'stub')
    if path.exists():
        existing_hash = sha256_file(path)
        if existing_hash == sha256_text(content):
            print(f'  Skipped (up to date) {path}')
            return
        if _manifest.is_stale_stub(path, existing_hash):
            path.write_text(content, encoding='utf-8')
            print(f'  Refreshed (stale stub, schema changed since it was first generated) {path}')
            return
        print(f'  Skipped (exists) {path}')
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
    print(f'  Wrote {path}')


# Collects reminders about write-once stubs the generator just created. These are
# hand-written extension points the generator cannot fill in; printed as an
# ACTION REQUIRED summary at the end of generate() and reset at its start.
_handwritten_notices: list[str] = []


def _note_stub_created(path: Path, why: str, action: str) -> None:
    _handwritten_notices.append(f'  - {path}\n      {why}\n      -> {action}')


def _resolve_set_fields(entity_props: dict, raw: dict) -> dict:
    resolved = {}
    for field, value in raw.items():
        prop_def = entity_props.get(field, {})
        actual = _get_actual_type(prop_def)
        enum_vals = prop_def.get('enum')
        if actual in ('integer', 'number') and isinstance(enum_vals, list) and isinstance(value, str):
            lower_labels = [str(v).lower() for v in enum_vals]
            if value.lower() not in lower_labels:
                raise ValueError(
                    f"set_fields: label '{value}' not found in enum {enum_vals} "
                    f"for field '{field}'"
                )
            resolved[field] = lower_labels.index(value.lower())
        else:
            resolved[field] = value
    return resolved


# ---------------------------------------------------------------------------
# Search text_fields auto-derivation helpers
# ---------------------------------------------------------------------------
#
# _derive_text_fields is an alias for helpers.schema_helpers.derive_text_fields
# (imported above) so build_context.py's searchable_text_fields
# (searchXxxOptions autocomplete filter) can share the same exclusion rule
# instead of a hardcoded field list.


def _derive_mention_fields(properties: dict) -> list[str]:
    """Return field names annotated with x-mention: true.

    These fields store @[user_id:uuid] mention syntax and require mention-parser
    utilities at render time. Detected here so Phase 2 templates can use the list.
    """
    return [
        field_name
        for field_name, prop in properties.items()
        if isinstance(prop, dict) and prop.get('x-mention') is True
    ]


def _derive_gdpr_mode_fields(properties: dict) -> dict[str, str]:
    """Return a mapping of field_name -> x-gdpr-mode for fields that have the annotation.

    Fields without x-gdpr-mode are not included; callers should default to 'both'.
    """
    return {
        field_name: prop.get('x-gdpr-mode', 'both')
        for field_name, prop in properties.items()
        if isinstance(prop, dict) and prop.get('x-gdpr-mode') is not None
    }


def _get_model_gdpr_mode(model_def: dict) -> str:
    """Return the model-level x-gdpr-mode value, defaulting to 'both'."""
    return model_def.get('x-gdpr-mode', 'both')


def _get_primary_display_field(entity_defs: list) -> str | None:
    """Return the x-display.table primary field from the first definition that has one."""
    for defn in entity_defs:
        if not isinstance(defn, dict):
            continue
        x_display = defn.get('x-display') or {}
        table = x_display if isinstance(x_display, list) else x_display.get('table')
        if not table:
            continue
        for col in table:
            if not isinstance(col, dict):
                continue
            for col_name, col_cfg in col.items():
                if isinstance(col_cfg, dict) and col_cfg.get('primary'):
                    return col_name
    return None


def _append_no_page_child(
    lst: list, child_name: str, parent_id_field: str,
    text_fields: list, child_base_def: dict
) -> None:
    """Build no_page_child context dict and append to lst.

    All field references are qualified with the `child.` alias — the child
    subquery JOINs "child" against "parent", and unqualified column names
    (e.g. `name`) are ambiguous whenever the parent table has a same-named
    column (e.g. dashboard.name vs dashboard_widget.name).
    """
    ts_parts = " || ' ' || ".join(f"COALESCE(child.{f}, '')" for f in text_fields)
    sim_exprs = ', '.join(f"similarity(COALESCE(child.{f}, ''), ${{q}})" for f in text_fields)
    sim_where = ' OR '.join(
        f"similarity(COALESCE(child.{f}, ''), ${{q}}) > 0.3" for f in text_fields
    )
    bigm_fields = text_fields  # default: same as text_fields
    bigm_where = ' OR '.join(
        f"COALESCE(child.{f}, '') ILIKE '%' || ${{q}} || '%'" for f in bigm_fields
    )
    bigm_sim_exprs = ', '.join(
        f"CASE WHEN COALESCE(child.{f}, '') ILIKE '%' || ${{q}} || '%'"
        f" THEN 1.0 ELSE 0.0 END::float8"
        for f in bigm_fields
    )
    child_primary = _get_primary_display_field([child_base_def])
    snippet_raw = child_primary if (child_primary and child_primary in text_fields) else text_fields[0]
    snippet = f"child.{snippet_raw}"

    lst.append({
        'child_name':                 child_name,
        'parent_id_field':            parent_id_field,
        'text_fields':                text_fields,
        'snippet_field':              snippet,
        'ts_vector_fields_sql':       ts_parts,
        'similarity_fields_sql':      sim_exprs,
        'similarity_where_sql':       sim_where,
        'bigm_where_sql':             bigm_where,
        'bigm_similarity_fields_sql': bigm_sim_exprs,
    })


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def generate(schema_path: str, output_dir: str) -> None:
    with open(schema_path) as f:
        schema = yaml.safe_load(f)

    # x-cloud opt-in: only generate cloud artifacts when explicitly enabled
    x_cloud = schema.get('x-cloud', None)
    cloud_enabled = (
        x_cloud is not None
        and x_cloud.get('enabled', False)
        and x_cloud.get('provider') is not None
    )
    cloud_provider = x_cloud.get('provider', '') if x_cloud else ''

    try:
        validate_schema(schema)
        validate_prisma_indexes(Path(output_dir) / 'prisma' / 'schema.prisma')
    except SchemaValidationError as exc:
        print(f'\n{exc}', file=sys.stderr)
        sys.exit(1)

    entities = extract_entities(schema)
    if not entities:
        print('No entities found in schema', file=sys.stderr)
        return

    out = Path(output_dir)
    global _manifest
    _manifest = ManifestRecorder(out=out)
    _handwritten_notices.clear()

    env = _make_env()

    # Load messages/en.json Fields namespace for enum label translation in Cypress tests
    import json as _json
    _msg_path = out / 'messages' / 'en.json'
    if _msg_path.exists():
        with open(_msg_path) as _mf:
            _all_messages = _json.load(_mf)
        set_messages_fields(_all_messages.get('Fields', {}))
        set_messages_namespaces(_all_messages)

    # --- Bridge Prisma schema emission ---
    bridges = _collect_bridges(schema)
    if bridges:
        inject_bridge_into_schema(out / 'prisma' / 'schema.prisma', bridges)
        bridge_additions = build_bridge_prisma_additions(schema)
        _write(out / 'prisma' / 'bridge_additions.prisma', bridge_additions)
        print(f'  Bridge Prisma additions (reference) → prisma/bridge_additions.prisma')

    print(f'Found {len(entities)} entities in {schema_path}')

    # Pre-compute named_constants so entity templates (getters.ts) can use it
    named_constants = extract_named_constants(schema)

    doc_dir = out / 'docs' / 'generated'
    entity_doc_summaries: list[dict] = []

    for entity in entities:
        parent     = entity['parent']
        model      = entity['model']
        gen_cfg    = entity.get('generate_config', {})

        can_list   = gen_cfg.get('list', True)
        can_view   = gen_cfg.get('view', True)
        can_new    = gen_cfg.get('new', True)
        can_edit   = gen_cfg.get('edit', True)
        can_delete = gen_cfg.get('delete', True)
        can_api    = gen_cfg.get('api', False)
        can_export = gen_cfg.get('export', True)    # cmd_330

        # invalidate flag: accepts bool or {enabled, handler, module}
        _inv = gen_cfg.get('invalidate', False)
        if isinstance(_inv, dict):
            can_invalidate    = bool(_inv.get('enabled', False))
            invalidate_handler = _inv.get('handler', '')
            invalidate_module  = _inv.get('module', '')
        else:
            can_invalidate    = bool(_inv)
            invalidate_handler = ''
            invalidate_module  = ''

        print(f'\nGenerating: {parent}' + (f' (model: {model})' if model != parent else ''))

        # Paths
        lib_dir        = out / 'lib'        / parent
        components_dir = out / 'components' / parent
        app_dir        = out / 'app' / '[locale]' / parent

        # --- types.ts (uses separate EntityContext dataclass) ---
        types_ctx = build_entity_context(entity, schema)
        _write(lib_dir / 'types.ts', _render(env, 'types.ts.jinja2', asdict(types_ctx)))

        # Base context for all other generators
        ctx = build_context(entity, schema, has_reactions=bool(named_constants))

        # --- docs/{parent}.md + app/[locale]/docs/{parent}/page.mdx ---
        doc_ctx = build_doc_entity_context(ctx)
        md_content = _render(env, 'doc_entity.md.jinja2', doc_ctx)
        _write(doc_dir / f'{parent}.md', md_content)
        _write(
            out / 'app' / '[locale]' / 'docs' / parent / 'page.mdx',
            convert_md_to_mdx(md_content, link_prefix=''),
        )
        entity_doc_summaries.append({
            'parent':     doc_ctx['parent'],
            'title':      doc_ctx['title'],
            'operations': doc_ctx['operations'],
            'can_api':    doc_ctx['can_api'],
            'has_chart':  doc_ctx['has_chart'],
        })

        # --- getters.ts ---
        getters_ctx = {**ctx, 'named_constants': named_constants}
        _write(lib_dir / 'getters.ts', _render(env, 'getters.ts.jinja2', getters_ctx))

        # --- autocomplete/list custom filter stubs (cmd_377/379 DP-1) ---
        # search{Target}Options()/get{Target}Page() in getters.ts (just written
        # above) always call these — one write-once stub per entity, alongside
        # getters.ts, following the same _write_stub() skip-if-exists convention
        # as service_after_create.ts / ledger_write.ts. Default (unedited) stubs
        # return {} — a documented zero-impact no-op (see getters.ts.jinja2).
        parent_pascal = to_pascal_case(parent)
        _write_stub(
            lib_dir / 'autocomplete_filter.ts',
            _render(env, 'autocomplete_filter_stub.ts.jinja2', {
                'parent': parent,
                'parent_pascal': parent_pascal,
            }),
        )
        _write_stub(
            lib_dir / 'list_filter.ts',
            _render(env, 'list_filter_stub.ts.jinja2', {
                'parent': parent,
                'parent_pascal': parent_pascal,
            }),
        )

        # --- virtual column resolver stub (per-entity, async/bulk) ---
        if ctx.get('virtual_columns'):
            vr_path = lib_dir / 'virtual_resolvers.ts'
            created = _write_stub(
                vr_path,
                _render(env, 'virtual_resolver.ts.jinja2', {
                    'parent': parent,
                    'parent_pascal': parent_pascal,
                    'virtual_columns': ctx['virtual_columns'],
                }),
            )
            if created:
                vcs = ', '.join(vc['field_name'] for vc in ctx['virtual_columns'])
                _note_stub_created(
                    vr_path,
                    f'Entity "{parent}" has virtual column(s) [{vcs}] with no resolver.',
                    'Implement resolveVirtualColumns() (the blank stub returns empty '
                    'values) and commit the file to your project SoT so it survives '
                    'cleanup and a fresh rebuild.',
                )

        # --- service.ts + service_validation stub ---
        if can_new or can_edit or can_delete:
            svc_ctx = {**ctx, **service_context(ctx, schema)}
            _write(lib_dir / 'service.ts', _render(env, 'service.ts.jinja2', svc_ctx))
            if can_new or can_edit:
                val_ctx = {**ctx, **build_validation_context(ctx)}
                _write(lib_dir / 'service_validation.ts', _render(env, 'service_validation.ts.jinja2', val_ctx))
            if can_new or ctx.get('bridge_child_ir'):
                # Bridge children create via parent context (cmd_167 §4), so their
                # service imports afterCreate — emit the write-once stub for them too.
                _write_stub(
                    lib_dir / 'service_after_create.ts',
                    _render(env, 'service_after_create_stub.ts.jinja2', ctx),
                )

        # --- reservation_actions.ts + per-action API routes ---
        _res_cfg = ctx.get('reservation_config')
        if _res_cfg and _res_cfg.get('has_actions'):
            _act_routes = get_reservation_action_routes(_res_cfg, ctx['model'])
            if _act_routes:
                # Build reservation_actions.ts via template
                _svc_acts = svc_ctx.get('reservation_actions_code', '') if (can_new or can_edit or can_delete) else ''
                if _svc_acts:
                    _ra_ctx = {**ctx, 'reservation_actions_code': _svc_acts}
                    _write(lib_dir / 'reservation_actions.ts',
                           _render(env, 'reservation_actions.ts.jinja2', _ra_ctx))
                    print(f'  reservation_actions.ts → lib/{parent}/')
                # Per-action API routes
                api_actions_base = out / 'app' / 'api' / parent / '[id]' / 'actions'
                for _route in _act_routes:
                    _write(api_actions_base / _route['act_type'] / 'route.ts', _route['code'])
                print(f'  Action routes → app/api/{parent}/[id]/actions/{{ship,release,cancel}}/')
                # UI action buttons component
                _write(
                    components_dir / 'ReservationActionButtons.tsx',
                    _render(env, 'action_buttons.tsx.jinja2', ctx),
                )
                print(f'  ReservationActionButtons.tsx → components/{parent}/')

        # --- actions.ts ---
        if can_new or can_edit or can_delete or can_invalidate:
            act_ctx = {**ctx, **actions_context(ctx)}
            _write(lib_dir / 'actions.ts', _render(env, 'actions.ts.jinja2', act_ctx))

        # --- API routes ---
        if can_api:
            api_dir = out / 'app' / 'api' / parent
            if can_list or can_new:
                _write(api_dir / 'route.ts', _render(env, 'api_route.ts.jinja2', ctx))
            if can_view or can_edit or can_delete:
                _write(api_dir / '[id]' / 'route.ts', _render(env, 'api_detail_route.ts.jinja2', ctx))
            if can_new or can_edit or can_delete:
                _write(api_dir / 'bulk' / 'route.ts', _render(env, 'api_bulk_route.ts.jinja2', ctx))
            print(f'  API routes → app/api/{parent}/')

            # --- CSV Export route (Phase 1: can_api+can_list+can_export) ---
            if can_list and can_export:                    # cmd_330
                _write(api_dir / 'export' / 'route.ts',
                       _render(env, 'api_export_route.ts.jinja2', ctx))
                print(f'  CSV Export route → app/api/{parent}/export/')

            # --- CSV Import route (Phase 2: entities with x-import-key + new/edit) ---
            if ctx.get('import_eligible'):
                _write(api_dir / 'import' / 'route.ts',
                       _render(env, 'api_import_route.ts.jinja2', ctx))
                print(f'  CSV Import route → app/api/{parent}/import/')
                # --- ImportModal UI component (batch4) ---
                _write(components_dir / 'ImportModal.tsx',
                       _render(env, 'components/ImportModal.tsx.jinja2', ctx))
                print(f'  ImportModal → components/{parent}/ImportModal.tsx')

        # --- Invalidate action route (independent of can_api) ---
        if can_invalidate:
            inv_api_dir = out / 'app' / 'api' / parent / '[id]' / 'actions' / 'invalidate'
            _write(inv_api_dir / 'route.ts',
                   _render(env, 'invalidate_action_route.ts.jinja2', ctx))
            print(f'  Invalidate route → app/api/{parent}/[id]/actions/invalidate/')

        # --- column_def.tsx ---
        has_children = bool(entity.get('children'))
        if has_children and (can_view or can_edit):
            col_ctx = {**ctx, **column_def_context(ctx, schema)}
            _write(components_dir / 'column_def.tsx', _render(env, 'column_def.tsx.jinja2', col_ctx))

        # --- FormUpsert.tsx + form_validation stub ---
        if can_new or can_edit:
            ups_ctx = {**ctx, **form_upsert_context(ctx, schema)}
            _write(components_dir / 'FormUpsert.tsx', _render(env, 'form_upsert.tsx.jinja2', ups_ctx))
            val_ctx = {**ctx, **build_validation_context(ctx)}
            _write(components_dir / 'form_validation.ts', _render(env, 'form_validation.ts.jinja2', val_ctx))

        # --- FormView.tsx ---
        if can_view:
            fv_ctx = {**ctx, **form_view_context(ctx, schema)}
            _write(components_dir / 'FormView.tsx', _render(env, 'form_view.tsx.jinja2', fv_ctx))

        # --- <Child>BridgeGrid.tsx (parent-embedded DataGrid, cmd_167 §4) ---
        # Emitted for bridge children (entities with new-form x-bridge); the
        # component is embedded on each parent's FormView (see form_view_context).
        _self_bridge = get_new_form_bridge(schema['definitions'].get(model, {}))
        if _self_bridge:
            _bg_cols = (schema['definitions'].get(model, {}).get('x-display') or {}).get('table') or []
            _model_props = schema['definitions'].get(model, {}).get('properties', {}) or {}
            _df_entries = []
            for _col in _bg_cols:
                for _fname, _fcfg in _col.items():
                    _w = (_fcfg or {}).get('width')
                    _prop_def = _model_props.get(_fname, {})
                    _enum_vals = _prop_def.get('enum') if isinstance(_prop_def.get('enum'), list) and _prop_def.get('type') in ('integer', 'number') else None
                    if _enum_vals:
                        _enum_map = ', '.join(f"{i}: tf('{_fname}_{v}')" for i, v in enumerate(_enum_vals))
                        _df_entries.append(
                            "{ field: '%s', headerName: tf('%s')%s, enumLabels: { %s } }"
                            % (_fname, _fname, f', width: {_w}' if _w else '', _enum_map)
                        )
                    else:
                        from build_context import get_uri_kind
                        _uri_kind_attr = ", uriKind: 'link'" if get_uri_kind(_prop_def) == 'link' else ''
                        _df_entries.append(
                            "{ field: '%s', headerName: tf('%s')%s%s }"
                            % (_fname, _fname, f', width: {_w}' if _w else '', _uri_kind_attr)
                        )
            if not _df_entries:
                _df_entries = ["{ field: 'id', headerName: 'id' }"]
            _write(
                components_dir / f'{parent_pascal}BridgeGrid.tsx',
                _render(env, 'bridge_grid.tsx.jinja2', {
                    'child': parent,
                    'child_pascal': parent_pascal,
                    'bridge_fk': f"{_self_bridge['name']}_id",
                    'display_fields': ', '.join(_df_entries),
                }),
            )

        # --- Determine which pages to generate (x-display) ---
        xdisplay        = ctx.get('xdisplay')
        xdisplay_table  = ctx.get('xdisplay_table')
        has_chart       = ctx.get('has_chart', False)

        # showTable: true when no x-display at all, or x-display.table is set
        show_table = (not xdisplay) or (xdisplay_table is not None)

        # --- page list ---
        if can_list and show_table:
            pl_ctx = {**ctx, **page_list_context(ctx, schema)}
            _write(app_dir / 'page.tsx', _render(env, 'page_list.tsx.jinja2', pl_ctx))

        # --- chart pages ---
        if has_chart:
            ch_ctx = {**ctx, **chart_context(ctx, schema)}
            _write(lib_dir / 'chart-getters.ts', _render(env, 'chart_getters.ts.jinja2', ch_ctx))
            _write(app_dir / 'chart' / 'page.tsx', _render(env, 'page_chart.tsx.jinja2', ch_ctx))
            print(f'  Chart → app/[locale]/{parent}/chart/')

        # --- page new ---
        # AP-2=A: creation is parent-context only. Bridge children set new:false to
        # suppress the *standalone* create path, but still need a new page driven by
        # parent context from the URL (?parentType=&parentId=) supplied by the
        # parent-embedded grid (cmd_167 §4); the form binds the parent implicitly
        # and never shows a parent picker.
        if can_new or ctx.get('bridge_child_ir'):
            _write(app_dir / 'new' / 'page.tsx', _render(env, 'page_new.tsx.jinja2', ctx))

        # --- page edit ---
        if can_edit:
            _write(app_dir / 'edit' / '[id]' / 'page.tsx', _render(env, 'page_edit.tsx.jinja2', ctx))

        # --- page view ---
        if can_view:
            _write(app_dir / 'view' / '[id]' / 'page.tsx', _render(env, 'page_view.tsx.jinja2', ctx))

    # --- x-splittable: split action route + UI per entity (cmd_296) ---
    #
    # Entities marked x-splittable get a POST /actions/split route that closes
    # out the parent (status=split, approvable invalidated — FS-2) and creates
    # child records inheriting the parent's fields. The split quantity field,
    # the self-referential parent FK, and the split-result boolean flag are
    # declared via x-splittable (or auto-detected) rather than hardcoded, so
    # any entity can opt in by declaring x-splittable — not just receiving.
    #
    # x-splittable accepts two forms:
    #   - `true` (legacy/bool): route only, no Σ validation, no UI.
    #   - `{quantityField, perPartRequired?, parentField?, splitResultField?}`
    #     (dict): route + Σ validation + SplitActionSection.tsx UI.
    #     parentField/splitResultField are auto-detected when omitted.
    def _detect_split_parent_field(props: dict, entity_name: str) -> str | None:
        """Self-referential many-to-one FK pointing back at `entity_name`."""
        for prop_name, prop_def in props.items():
            rel = (prop_def or {}).get('x-relationship') or {}
            if rel.get('type') == 'many-to-one' and rel.get('target') == entity_name:
                return prop_name
        return None

    def _detect_split_result_field(props: dict) -> str | None:
        """Boolean property named 'is_split_result' by convention."""
        for prop_name, prop_def in props.items():
            if (prop_def or {}).get('type') == 'boolean' and prop_name == 'is_split_result':
                return prop_name
        return None

    def _detect_product_id_field(props: dict) -> str | None:
        """Many-to-one FK pointing at product, for split auto-allocate queries."""
        for prop_name, prop_def in props.items():
            rel = (prop_def or {}).get('x-relationship') or {}
            if rel.get('type') == 'many-to-one' and rel.get('target') == 'product':
                return prop_name
        return None

    _splittable_defs = schema.get('definitions', {})
    for _def_key, _def_val in _splittable_defs.items():
        if not _def_key.startswith('__'):
            continue
        _split_cfg = _def_val.get('x-splittable')
        if not _split_cfg:
            continue
        # x-splittable stays on the raw entity (_def_key, '__'-prefixed); every
        # downstream use — file paths, TS identifiers, template context, FK
        # target comparisons — needs the bare model name.
        _def_key = _def_key[2:]
        _split_entity_props = _def_val.get('properties', {})
        _split_status_enum = (_split_entity_props.get('status') or {}).get('enum') or []

        _splittable_dict = _split_cfg if isinstance(_split_cfg, dict) else {}
        _qty_field    = _splittable_dict.get('quantityField')
        _per_part_req = list(_splittable_dict.get('perPartRequired') or [])
        _parent_f = _splittable_dict.get('parentField') or _detect_split_parent_field(_split_entity_props, _def_key)
        _split_r_f = _splittable_dict.get('splitResultField') or _detect_split_result_field(_split_entity_props)

        # cmd_305 FIX-B: split children of an entity whose approval hook
        # reserves inventory (x-approval.on_approved.emit_hook) get their own
        # ledger-transaction bridge per child, so the existing
        # afterApprove/afterReject hooks (which guard on a non-null bridge)
        # fire correctly instead of silently no-op'ing. See
        # docs/reservation-split-approval-reject-design.md B-3.
        # cmd_312 Phase1: bridge field name config-driven via
        # x-splittable.bridgeField (default 'inventory_transactionable_id')
        # instead of a literal membership check — see
        # get_splittable_bridge_field docstring for why this reads from
        # x-splittable rather than reverse-resolving through x-reservation.
        _bridge_field = get_splittable_bridge_field(_def_val)
        _has_inventory_bridge = bool(
            _bridge_field in _split_entity_props
            and (_def_val.get('x-approval', {}) or {}).get('on_approved', {}).get('emit_hook')
        )
        _product_id_f = _detect_product_id_field(_split_entity_props)

        # cmd_307 FIX-β: entities whose x-ledger-source has event_type 'receive'
        # (e.g. receiving_receipt_line) add inventory on approval — they never
        # hold an existing reservation to validate/claim/release at split time.
        # Entities without x-ledger-source (or with a non-'receive' event_type,
        # e.g. purchase_per_item) keep the existing reserve/claim/release
        # semantics. Only meaningful when the entity has a bridge at all.
        _ledger_source = _def_val.get('x-ledger-source') or {}
        _split_reserves_inventory = _has_inventory_bridge and _ledger_source.get('event_type') != 'receive'

        # OD-1: domain resolution (required — no defaults — only when this
        # split entity actually has a ledger bridge to resolve).
        _ledger_domain_vars = {}
        if _has_inventory_bridge:
            _domain_key = _splittable_dict.get('ledgerDomain')
            if not _domain_key:
                raise ValueError(
                    f"x-splittable for {_def_key!r}: ledgerDomain is required when has_inventory_bridge (OD-1)"
                )
            _domain = resolve_ledger_domain(schema, _domain_key)
            _pool_fk_field = _splittable_dict.get('poolIdField')
            if not _pool_fk_field:
                raise ValueError(
                    f"x-splittable for {_def_key!r}: poolIdField is required when has_inventory_bridge (OD-1)"
                )
            _ledger_domain_vars = {
                'ledger_entity': _domain['ledger'],
                'transactionable_entity': _domain['transactionable'],
                'pool_entity': _domain['pool'],
                'bridge_fk_field': _bridge_field,
                'pool_fk_field': _pool_fk_field,
            }

        # perPartRequired fields are enforced as mandatory (every part must
        # supply a truthy value) only when they're also in the entity's own
        # top-level `required:` list. purchase_per_item.inventory_id is in
        # perPartRequired (per-part lot override) but is schema-optional —
        # split falls back to auto-allocate when a part omits it (cmd_305
        # FIX-B, DP-B1). receiving_receipt_line.inventory_id is genuinely
        # required, so its mandatory check is unaffected.
        _entity_required = set(_def_val.get('required') or [])
        _per_part_req_mandatory = [f for f in _per_part_req if f in _entity_required]

        _always_exclude = {
            'id', 'status', 'approvable_id', _bridge_field,
            *([_qty_field] if _qty_field else []),
            *([_parent_f] if _parent_f else []),
            *([_split_r_f] if _split_r_f else []),
            *_per_part_req,
        }

        _split_has_approvable = 'approvable_id' in _split_entity_props
        # cmd_296 Phase2: one approvable per part, created directly in the
        # per-part loop (no pre-create array — unlike cmd_295's x-approval-lines
        # batch). Shares its inner block with _build_approval_lines_post_create_code
        # via generators.py:_build_approval_create_block_for_entity (see
        # docs/split-generalization-design.md §4.2).
        _split_approval_create_block = (
            _build_approval_create_block_for_entity(
                approvable_id_expr='childApprovable.id',
                actor_id_expr='userId',
                flows_var='_splitApprovalFlows',
                role_ids_var='_splitCreatorRoleIds',
                tx_var='tx',
                indent='        ',
            )
            if _split_has_approvable else ''
        )

        _split_ctx = {
            'entity_name': _def_key,
            'pascal_name': to_pascal_case(_def_key),
            'status_split_value': _split_status_enum.index('split') if 'split' in _split_status_enum else 1,
            'status_rejected_value': _split_status_enum.index('rejected') if 'rejected' in _split_status_enum else 2,
            'has_approvable': _split_has_approvable,
            'approval_create_block': _split_approval_create_block,
            'has_quantity_check': bool(_qty_field),
            'quantity_field': _qty_field,
            'per_part_required': _per_part_req,
            'parent_field': _parent_f,
            'split_result_field': _split_r_f,
            'inherited_fields': [f for f in _split_entity_props if f not in _always_exclude],
            'has_inventory_bridge': _has_inventory_bridge,
            'split_reserves_inventory': _split_reserves_inventory,
            'product_id_field': _product_id_f,
            'per_part_required_mandatory': _per_part_req_mandatory,
            **_ledger_domain_vars,
        }
        _split_api_dir = out / 'app' / 'api' / _def_key / '[id]' / 'actions' / 'split'
        _write(_split_api_dir / 'route.ts', _render(env, 'split_action_route.ts.jinja2', _split_ctx))
        print(f'  Split action route → app/api/{_def_key}/[id]/actions/split/')

        # UI generation: only when quantityField is declared (dict form). The
        # legacy bool form (`x-splittable: true`) keeps pre-cmd_296 API-only
        # behavior — no UI, no Σ validation.
        if _qty_field:
            _split_ui_parts = []
            _split_uses_format_label_value = False
            _split_has_relation_field = False
            # DP-B (cmd_424): give SplitActionSection's per-part autocomplete
            # pickers access to sibling scalar field values (e.g. the parent's
            # product_id, to narrow inventory_id candidates), reusing the same
            # 'x-autocomplete-context' annotation DP-5 defined for FormUpsert
            # relation fields (schema_helpers.get_parent_relationships) —
            # applied here to whichever perPartRequired FK field carries it.
            # Purely schema-structure-driven (cmd_420 convention: no entity-
            # name check), so every other split entity's generated UI is
            # byte-identical unless it declares this annotation itself.
            _split_has_context_field = False
            _section_context_fields = []
            for _f in _per_part_req:
                _f_def = _split_entity_props.get(_f, {})
                _f_rel = (_f_def or {}).get('x-relationship') or {}
                _f_target = _f_rel.get('target')
                if not _f_target:
                    # No FK relation declared for this field — plain text input.
                    _split_ui_parts.append({'field': _f, 'is_relation': False, 'context_fields': []})
                    continue
                _f_label_field = _f_rel.get('labelField', 'id')
                _f_built = build_label_expression('item', _f_label_field, _f_target, schema)
                if _f_built['has_format']:
                    _split_uses_format_label_value = True
                _split_has_relation_field = True
                _f_ctx_fields = list(_f_def.get('x-autocomplete-context') or [])
                if _f_ctx_fields:
                    _split_has_context_field = True
                    for _cf in _f_ctx_fields:
                        if _cf not in _section_context_fields:
                            _section_context_fields.append(_cf)
                _split_ui_parts.append({
                    'field': _f,
                    'is_relation': True,
                    'target': _f_target,
                    'target_pascal': to_pascal_case(_f_target),
                    'label_expr': _f_built['expression'],
                    'context_fields': _f_ctx_fields,
                })
            _split_ui_ctx = {
                'entity_name': _def_key,
                'pascal_name': to_pascal_case(_def_key),
                'quantity_field': _qty_field,
                'per_part_required': _split_ui_parts,
                'split_uses_format_label_value': _split_uses_format_label_value,
                'split_has_relation_field': _split_has_relation_field,
                'split_has_context_field': _split_has_context_field,
                'section_context_fields': _section_context_fields,
            }
            _split_ui_dir = out / 'components' / _def_key
            _write(_split_ui_dir / 'SplitActionSection.tsx', _render(env, 'split_action_section.tsx.jinja2', _split_ui_ctx))
            print(f'  SplitActionSection.tsx → components/{_def_key}/')

    # --- Dashboard catalog (lib/dashboard/catalog.ts) ---
    dashboard_catalog = build_dashboard_catalog(schema)
    if True:
        _write(
            out / 'lib' / 'dashboard' / 'catalog.ts',
            _render(env, 'dashboard_catalog.ts.jinja2', {'entities': dashboard_catalog}),
        )
        print(f'  Dashboard catalog → lib/dashboard/catalog.ts ({len(dashboard_catalog)} entities)')

    # --- Dashboard aggregate REST endpoint (app/api/dashboard/aggregate/route.ts) ---
    # Emitted when at least one dashboardable entity exists so the endpoint
    # has entities to query. The route uses API-key auth + requireApiPermission.
    if dashboard_catalog:
        _write(
            out / 'app' / 'api' / 'dashboard' / 'aggregate' / 'route.ts',
            _render(env, 'dashboard_aggregate_route.ts.jinja2', {}),
        )
        print('  Dashboard aggregate route → app/api/dashboard/aggregate/route.ts')

    # --- Attachment bridge actions (lib/attachment/actions.ts) ---
    #
    # Emitted whenever at least one base entity owns the `attachable` bridge
    # (has `attachable_id` with x-relationship.target: attachable). Each
    # owner contributes a select branch + a revalidate-paths block, mirroring
    # the polymorphic bridge pattern used by `commentable` and `approvable`.
    # When no owner exists the file is left out and cleanup.py removes any
    # stale copy from a previous schema.
    attachable_owners = build_attachable_owners(schema)
    if True:
        _write(
            out / 'lib' / 'attachment' / 'actions.ts',
            _render(env, 'attachment_actions.ts.jinja2', {'owners': attachable_owners}),
        )
        print(f'  Attachment bridge actions → lib/attachment/actions.ts ({len(attachable_owners)} owners)')

    # --- Named constants (lib/reaction_constants.ts) ---
    # named_constants was pre-computed before the entity loop
    if named_constants:
        _write(
            out / 'lib' / 'reaction_constants.ts',
            _render(env, 'reaction_constants.ts.jinja2', {'named_constants': named_constants}),
        )
        print(f'  Named constants → lib/reaction_constants.ts ({len(named_constants)} constant(s))')

    # --- anonymize_user.ts (lib/compliance/anonymize_user.ts) ---
    # Emitted when the user entity has at least one x-pii annotated field.
    # Generates GDPR Art.17 right-to-erasure scrub function from x-pii annotations.
    anon_ctx = build_anonymize_user_context(schema)
    if anon_ctx['has_pii_user']:
        _write(
            out / 'lib' / 'compliance' / 'anonymize_user.ts',
            _render(env, 'anonymize_user.ts.jinja2', anon_ctx),
        )
        print(f"  anonymize_user → lib/compliance/anonymize_user.ts ({len(anon_ctx['pii_fields'])} x-pii fields)")

    # --- Mention parser (lib/mention/parser.ts) ---
    # Emitted when at least one field in any schema definition is annotated with x-mention: true.
    _has_any_mention = any(
        any(
            isinstance(prop, dict) and prop.get('x-mention') is True
            for prop in defn.get('properties', {}).values()
        )
        for defn in schema.get('definitions', {}).values()
        if isinstance(defn, dict)
    )
    if _has_any_mention:
        _write(
            out / 'lib' / 'mention' / 'parser.ts',
            _render(env, 'mention_parser.ts.jinja2', {}),
        )
        print('  Mention parser → lib/mention/parser.ts')

    # --- Comment reactions API route (app/api/comment/[commentId]/reactions/toggle/route.ts) ---
    # Emitted whenever x-internal integer enum entities exist (i.e., reactions are enabled).
    # D3=A: toggle endpoint is POST /api/comment/[commentId]/reactions/toggle
    if named_constants:
        _write(
            out / 'app' / 'api' / 'comment' / '[commentId]' / 'reactions' / 'toggle' / 'route.ts',
            _render(env, 'comment_reactions_api_route.ts.jinja2', {}),
        )
        print('  Comment reactions API route → app/api/comment/[commentId]/reactions/toggle/route.ts')

    # --- Approval event dispatch (lib/approval_request/on_approved_dispatch.ts) ---
    #
    # Emitted when at least one entity declares `x-approval` at the top level.
    # Builds an `approvable_entities` list and generates the dispatch module plus
    # per-entity service_after_approve once-stubs (emit_hook: true only).
    defs = schema.get('definitions', {})
    approvable_entities = []
    for def_key, def_val in defs.items():
        if not def_key.startswith('__'):
            continue
        x_approval = def_val.get('x-approval')
        if not x_approval:
            continue
        on_approved = x_approval.get('on_approved', {})
        if not on_approved:
            continue
        # x-approval stays on the raw entity (def_key, '__'-prefixed); template
        # context (snake_name/pascal_name/lib path) needs the bare model name.
        def_key = def_key[2:]
        x_ledger_source = def_val.get('x-ledger-source', {})
        x_splittable = def_val.get('x-splittable', {})
        entity_props = def_val.get('properties', {})
        resolved_sf = _resolve_set_fields(entity_props, on_approved.get('set_fields') or {})
        # OD-1: domain resolution (required — no defaults — only when this
        # entity actually declares x-ledger-source).
        _ent_domain_vars = {}
        if x_ledger_source:
            _ent_domain_key = x_ledger_source.get('ledgerDomain')
            if not _ent_domain_key:
                raise ValueError(
                    f"x-ledger-source for {def_key!r}: ledgerDomain is required (OD-1)"
                )
            _ent_domain = resolve_ledger_domain(schema, _ent_domain_key)
            _ent_domain_vars = {
                'ledger_entity': _ent_domain['ledger'],
                'transactionable_entity': _ent_domain['transactionable'],
                'pool_entity': _ent_domain['pool'],
                # Entity's own per-row bridge FK — same config source as the
                # split-route bridge field (get_splittable_bridge_field), since
                # a ledger-source entity's bridge FK is declared identically.
                'bridge_fk_field': get_splittable_bridge_field(def_val),
            }
        elif x_splittable.get('ledgerDomain'):
            # Phase 3 / OD-3 (Option B): a splittable, approval-driven entity with
            # no x-ledger-source of its own (e.g. purchase_per_item) is the "Ship"
            # side of a ledger_transaction reservation — reserved_quantity was
            # already moved at reserve time, and approval nets outstanding
            # reserved_delta per lot before writing the ship row(s). Resolve the
            # same domain the split route uses (x-splittable.ledgerDomain) so the
            # generated skeleton names the real entities instead of a bare TODO.
            _ent_domain = resolve_ledger_domain(schema, x_splittable['ledgerDomain'])
            _ent_domain_vars = {
                'ledger_entity': _ent_domain['ledger'],
                'transactionable_entity': _ent_domain['transactionable'],
                'pool_entity': _ent_domain['pool'],
                'bridge_fk_field': get_splittable_bridge_field(def_val),
                'is_ship_skeleton': True,
            }
        approvable_entities.append({
            'snake_name': def_key,
            'pascal_name': to_pascal_case(def_key),
            'set_fields': resolved_sf,
            'emit_hook': bool(on_approved.get('emit_hook', False)),
            'has_ledger_source': bool(x_ledger_source),
            'ledger_source': x_ledger_source,
            'is_ship_skeleton': False,
            **_ent_domain_vars,
        })
    _write(
        out / 'lib' / 'approval_request' / 'on_approved_dispatch.ts',
        _render(env, 'on_approved_dispatch.ts.jinja2', {'approvable_entities': approvable_entities}),
    )
    print(f'  Approval dispatch → lib/approval_request/on_approved_dispatch.ts ({len(approvable_entities)} entities)')
    for ent in approvable_entities:
        if ent['emit_hook']:
            if ent.get('has_ledger_source'):
                _event_type = ent.get('ledger_source', {}).get('event_type', '')
                if _event_type == 'move':
                    template_name = 'ledger_move_stub.ts.jinja2'
                elif _event_type == 'adjust':
                    template_name = 'ledger_adjust_stub.ts.jinja2'
                else:
                    template_name = 'ledger_write_stub.ts.jinja2'
            else:
                template_name = 'service_after_approve_stub.ts.jinja2'
            _write_stub(
                out / 'lib' / ent['snake_name'] / 'service_after_approve.ts',
                _render(env, template_name, ent),
            )
            print(f"  Approval stub → lib/{ent['snake_name']}/service_after_approve.ts")

    # --- Rejection event dispatch (lib/approval_request/on_rejected_dispatch.ts) ---
    #
    # Emitted when at least one entity declares `x-approval.on_rejected`.
    # Symmetric to on_approved. Builds rejectable_entities list, generates
    # dispatch module and per-entity service_after_reject once-stubs (emit_hook only).
    rejectable_entities = []
    for def_key, def_val in defs.items():
        if not def_key.startswith('__'):
            continue
        x_approval = def_val.get('x-approval')
        if not x_approval:
            continue
        on_rejected = x_approval.get('on_rejected', {})
        if not on_rejected:
            continue
        def_key = def_key[2:]
        entity_props = def_val.get('properties', {})
        resolved_sf = _resolve_set_fields(entity_props, on_rejected.get('set_fields') or {})
        rejectable_entities.append({
            'snake_name': def_key,
            'pascal_name': to_pascal_case(def_key),
            'set_fields': resolved_sf,
            'emit_hook': bool(on_rejected.get('emit_hook', False)),
            'terminal': bool(on_rejected.get('terminal', False)),
        })
    _write(
        out / 'lib' / 'approval_request' / 'on_rejected_dispatch.ts',
        _render(env, 'on_rejected_dispatch.ts.jinja2', {'rejectable_entities': rejectable_entities}),
    )
    print(f'  Rejection dispatch → lib/approval_request/on_rejected_dispatch.ts ({len(rejectable_entities)} entities)')
    for ent in rejectable_entities:
        if ent['emit_hook']:
            _write_stub(
                out / 'lib' / ent['snake_name'] / 'service_after_reject.ts',
                _render(env, 'service_after_reject_stub.ts.jinja2', ent),
            )
            print(f"  Rejection stub → lib/{ent['snake_name']}/service_after_reject.ts")
    # --- Search templates (lib/search/helpers.ts + app/api/search/route.ts) ---
    # DP-3: default_scope from x-generator.search.default_scope.
    #   'opt_in' (default) — only entities with x-generate.search: true are searchable
    #   'all'              — all entities searchable; exclude with x-generate.search: false
    gen_config = schema.get('x-generator', {})
    search_default_scope = gen_config.get('search', {}).get('default_scope', 'opt_in')

    search_entities = []
    for entity in entities:
        model      = entity['model']
        parent     = entity['parent']
        def_key    = entity['definition_key']
        gen_cfg    = entity.get('generate_config', {})
        detail_def = schema['definitions'].get(def_key, {}) or {}
        # base_def: the raw entity backing `model` (properties/x-display/x-audit
        # live here). Prefer the '__'-prefixed raw form; fall back to the bare
        # view for entities with no raw counterpart (e.g. 'setting', which
        # proxies the 'user' view instead of having its own raw twin).
        base_def   = schema['definitions'].get(f'__{model}', {}) or schema['definitions'].get(model, {}) or {}

        # Determine if this entity is search-enabled per DP-3 logic
        # generate_config only contains the standard keys; read 'search' from raw x-generate
        x_generate_raw = detail_def.get('x-generate') or base_def.get('x-generate') or {}
        explicit_search = x_generate_raw.get('search')  # True, False, or None
        # DP-b: x-audit:true entities default to search=false; requires explicit search:true to opt in
        is_audited = bool(
            detail_def.get('x-audit') is True
            or base_def.get('x-audit') is True
        )
        if search_default_scope == 'all':
            if is_audited and explicit_search is None:
                is_search = False
            else:
                is_search = explicit_search is not False
        else:  # opt_in
            is_search = explicit_search is True

        if not is_search:
            continue

        xsearch = detail_def.get('x-search') or {}
        if 'text_fields' in xsearch:
            # Explicit curated list takes priority
            text_fields = xsearch['text_fields']
        else:
            # DP-1: auto-derive from base entity string properties (noise + sensitive excluded)
            base_props = (base_def if isinstance(base_def, dict) else {}).get('properties', {})
            text_fields = _derive_text_fields(base_props)
            if not text_fields:
                print(f'  Search: {parent!r} has no suitable text_fields after exclusion — skipping from UNION')
                continue

        snippet_field = xsearch.get('snippet_field')
        if snippet_field is None:
            # Priority: x-display primary → first text_field
            primary = _get_primary_display_field([detail_def, base_def])
            snippet_field = primary if (primary and primary in text_fields) else text_fields[0]

        # bigm_fields: fields for Japanese 2-gram search (default: same as text_fields)
        bigm_fields   = xsearch.get('bigm_fields', text_fields)

        # Build SQL fragments used inside the Jinja2 template
        # ts_vector_fields_sql: concat of all text fields, COALESCE-wrapped
        ts_parts = " || ' ' || ".join(f"COALESCE({f}, '')" for f in text_fields)

        # similarity_fields_sql: GREATEST(similarity(f1, q), similarity(f2, q), ...)
        sim_exprs = ', '.join(f"similarity(COALESCE({f}, ''), ${{q}})" for f in text_fields)

        # similarity_where_sql: each field comparison with > 0.3 threshold
        # Used in WHERE: (sim_f1 > 0.3 OR sim_f2 > 0.3)
        sim_where_single = ' OR '.join(
            f"similarity(COALESCE({f}, ''), ${{q}}) > 0.3" for f in text_fields
        )

        # bigm_where_sql: ILIKE containment check (gin_trgm_ops accelerates ILIKE '%q%').
        # C3=A: use pg_trgm (Cloud SQL compatible) instead of pg_bigm (Cloud SQL unsupported).
        # pg_trgm's GIN index (gin_trgm_ops) accelerates ILIKE on Cloud SQL.
        # ILIKE '%'||q||'%' correctly matches mid-string Japanese (e.g. '権限' in '一般権限を...').
        bigm_where_single = ' OR '.join(
            f"COALESCE({f}, '') ILIKE '%' || ${{q}} || '%'" for f in bigm_fields
        )
        # bigm_similarity_fields_sql: containment-based rank score (0.0 or 1.0).
        # Wrapped in GREATEST(...) * 0.5 by the Jinja2 template.
        bigm_sim_exprs = ', '.join(
            f"CASE WHEN COALESCE({f}, '') ILIKE '%' || ${{q}} || '%' THEN 1.0 ELSE 0.0 END::float8"
            for f in bigm_fields
        )

        # Prisma model is lowercase (matches Prisma model definition)
        prisma_model = model  # e.g. 'organization'

        # DP-a: derive authorization variables from model definition (replaces org_filter/has_creator_filter)
        # DP-c: x-search.org_id_field allows filtering by a non-standard column (e.g. 'id' for organization)
        all_props = {}
        for item in (base_def if isinstance(base_def, dict) else {}).get('properties', {}).items():
            all_props[item[0]] = item[1]
        org_id_field_override = xsearch.get('org_id_field', None)
        has_organization_id = 'organization_id' in all_props
        should_filter_by_org = has_organization_id or (org_id_field_override is not None)
        effective_org_id_field = org_id_field_override if org_id_field_override else 'organization_id'
        # creator_id is always auto-injected by the code generator (present in every Prisma model)
        # assignee_id is entity-specific; check schema properties
        has_assignee_id = 'assignee_id' in all_props

        # Phase1+2: non-independent child entities searchable via the parent's page
        # (inline grid / embedded list children, and non-m2o flattened OTO relations).
        no_page_children = []

        # ---- Phase 1: children (inline grid / embedded list) ----
        for child in entity.get('children', []):
            child_name        = child['name']
            child_output_type = child.get('output_type')
            # skip non-grid/list (comments, etc.)
            if child_output_type not in (None, 'list'):
                continue
            # skip m2m (junction-table pattern, no parent_id in child)
            is_m2m = (child.get('relationship') or {}).get('type') == 'many-to-many'
            if is_m2m:
                continue
            # skip children with independent detail pages
            child_has_detail = bool(
                schema['definitions'].get(child_name, {}).get('x-generate')
            )
            if child_output_type == 'list' and child_has_detail:
                continue  # managed on its own page
            # derive text fields — x-display lives on the raw entity, so prefer
            # that; properties are resolved via the merged (raw+view) helper.
            child_base_def   = (
                schema['definitions'].get(f'__{child_name}', {})
                or schema['definitions'].get(child_name, {})
            )
            child_base_props = get_entity_properties(child_name, schema)
            child_text_fields = _derive_text_fields(child_base_props)
            if not child_text_fields:
                continue  # no searchable text
            _append_no_page_child(
                no_page_children, child_name, f'{model}_id',
                child_text_fields, child_base_def
            )

        # ---- Phase 2: flatten non-m2o (FK in target, pointing to parent) ----
        for fr in get_flatten_rels(parent, base_def, schema):
            if fr['is_m2o']:
                continue  # m2o flatten: FK in parent → skip (Phase3)
            target = fr['target']
            if bool(schema['definitions'].get(target, {}).get('x-generate')):
                continue  # target has own page
            target_base_def   = (
                schema['definitions'].get(f'__{target}', {})
                or schema['definitions'].get(target, {})
            )
            target_base_props = get_entity_properties(target, schema)
            target_text_fields = _derive_text_fields(target_base_props)
            if not target_text_fields:
                continue
            _append_no_page_child(
                no_page_children, target, f'{model}_id',
                target_text_fields, target_base_def
            )

        search_entities.append({
            'entity_type':           parent,
            'model':                 prisma_model,
            'text_fields':           text_fields,
            'snippet_field':         snippet_field,
            'ts_vector_fields_sql':  ts_parts,
            'similarity_fields_sql': sim_exprs,
            'similarity_where_sql':  sim_where_single,
            # DP-a: authorization variables aligned with build<Entity>AccessWhere
            'should_filter_by_org':  should_filter_by_org,
            'org_id_field':          effective_org_id_field,
            'has_assignee_id':       has_assignee_id,
            # Pre-computed TypeScript identifiers (avoids Jinja2/TypeScript ${{{...}}} delimiter conflict)
            'perms_ts_var':          f'{parent}Perms',
            'general_read_ts_var':   f'{parent}GeneralRead',
            'access_clauses_ts_var': f'{parent}AccessClauses',
            'access_where_ts_var':   f'{parent}AccessWhere',
            'or_clauses_ts_var':     f'{parent}OrClauses',
            'bigm_where_sql':            bigm_where_single,
            'bigm_similarity_fields_sql': bigm_sim_exprs,
            # Phase1+2: no_page_children search + parent-qualified ACL vars
            'no_page_children':             no_page_children,
            'parent_access_clauses_ts_var': f'{parent}ParentAccessClauses',
            'parent_access_where_ts_var':   f'{parent}ParentAccessWhere',
            'parent_or_clauses_ts_var':     f'{parent}ParentOrClauses',
            'bigm_fields':               bigm_fields,
        })

    if search_entities:
        search_ctx = {'search_entities': search_entities}
        _write(
            out / 'lib' / 'search' / 'helpers.ts',
            _render(env, 'search_helpers.ts.jinja2', search_ctx),
        )
        _write(
            out / 'app' / 'api' / 'search' / 'route.ts',
            _render(env, 'search_route.ts.jinja2', search_ctx),
        )
        _write(
            out / 'app' / '[locale]' / 'search' / 'page.tsx',
            _render(env, 'search_page.tsx.jinja2', search_ctx),
        )
        _write(
            out / 'app' / '[locale]' / 'search' / 'actions.ts',
            _render(env, 'search_actions.ts.jinja2', search_ctx),
        )
        _write(
            out / 'scripts' / 'create-gin-indexes.sql',
            _render(env, 'create_gin_indexes.sql.jinja2', search_ctx),
        )
        entity_names = ', '.join(e['entity_type'] for e in search_entities)
        print(f'  Search routes → lib/search/helpers.ts + app/api/search/route.ts ({entity_names})')
        print(f'  Search UI page → app/[locale]/search/page.tsx + actions.ts')
        print(f'  Search GIN index script → scripts/create-gin-indexes.sql (apply with psql before test:e2e:cy:api)')
        _write(
            out / 'lib' / 'db-init.ts',
            _render(env, 'db_init.ts.jinja2', search_ctx),
        )
        print(f'  DB init → lib/db-init.ts (GIN indexes for gin_trgm_ops)')
    else:
        # DP-2: no searchable entities — delete stale search files to prevent broken imports
        print('  Search: no searchable entities — skipping search route generation')
        _stale_search_files = [
            out / 'lib' / 'search' / 'helpers.ts',
            out / 'app' / 'api' / 'search' / 'route.ts',
            out / 'app' / '[locale]' / 'search' / 'page.tsx',
            out / 'app' / '[locale]' / 'search' / 'actions.ts',
            out / 'scripts' / 'create-gin-indexes.sql',
        ]
        for _stale in _stale_search_files:
            if _stale.exists():
                _stale.unlink()
                print(f'  Search: deleted stale {_stale.relative_to(out)}')

    # --- docs/generated/index.md + app/[locale]/docs/page.mdx ---
    print('\nGenerating documentation index...')
    index_ctx = build_doc_index_context(entity_doc_summaries)
    index_md = _render(env, 'doc_index.md.jinja2', index_ctx)
    _write(doc_dir / 'index.md', index_md)
    _write(
        out / 'app' / '[locale]' / 'docs' / 'page.mdx',
        convert_md_to_mdx(index_md, link_prefix='docs/'),
    )

    # --- Cypress test generation ---
    test_entities = [e for e in entities if e['generate_config'].get('test')]
    # db_ctx's test_entity_names (ALL_ENTITIES) is the actual set granted permissions
    # by grantAllEntityPermissions() at runtime — it's wider than test_entities alone
    # (e.g. an entity with x-generate.test: false but reached via another entity's
    # labelField still needs — and gets — a permission row). The permission entity's
    # own spec asserts an exact seed-only row count, so it must count this same set,
    # not just the raw test-spec entity list, or the two silently drift apart.
    _test_entity_names = sorted(e['parent'] for e in test_entities)
    db_ctx = db_helpers_context(schema, test_entity_names=_test_entity_names)
    _test_entity_count = len(db_ctx['test_entity_names'])
    if test_entities:
        print('\nGenerating Cypress tests...')
        cypress_support = out / 'cypress' / 'support'
        cypress_e2e    = out / 'cypress' / 'e2e'

        registry_infos = []
        for entity in test_entities:
            parent     = entity['parent']
            model      = entity['model']
            def_key    = entity['definition_key']
            children   = entity['children']
            gen_cfg    = entity['generate_config']

            print(f'  Test: {parent}')

            # helper.ts
            helper_ctx = helper_context(parent, children, schema, model, def_key, gen_cfg)
            _write(cypress_support / parent / 'helper.ts',
                   _render(env, 'test_helper.ts.jinja2', helper_ctx))

            # e2e spec (desktop)
            spec_ctx = spec_context(parent, children, schema, model, def_key, gen_cfg, _test_entity_count)
            _write(cypress_e2e / f'{parent}.cy.ts',
                   _render(env, 'test_spec.cy.ts.jinja2', spec_ctx))

            # e2e spec (mobile) — separate file under cypress/e2e/mobile/.
            # The mobile list view renders CardListClient instead of the
            # desktop DataGrid, so the assertions/selectors differ enough to
            # warrant their own spec rather than a viewport-switched variant
            # of the desktop one. Forms are responsive but currently share
            # the same FormUpsert at every viewport.
            _write(cypress_e2e / 'mobile' / f'{parent}.cy.ts',
                   _render(env, 'test_spec_mobile.cy.ts.jinja2', spec_ctx))

            # api spec (only if api: true)
            if gen_cfg.get('api'):
                api_ctx = api_spec_context(parent, children, schema, model, def_key, gen_cfg, _test_entity_count)
                _write(cypress_e2e / 'api' / f'{parent}.cy.ts',
                       _render(env, 'test_api_spec.cy.ts.jinja2', api_ctx))

            # reservation spec + helper (only for entities with x-reservation count mode)
            res_ctx = reservation_spec_context(parent, schema, children)
            if res_ctx:
                res_helper_ctx = reservation_helper_context(parent, schema, children)
                _write(cypress_support / parent / 'reservation_gen_helper.ts',
                       _render(env, 'test_reservation_helper.ts.jinja2', res_helper_ctx))
                _write(cypress_e2e / 'api' / f'{parent}_reservation_gen.cy.ts',
                       _render(env, 'test_reservation_spec.cy.ts.jinja2', res_ctx))

            registry_infos.append({
                'parent': parent,
                'model_name': model,
                'children': children,
                'definition_key': def_key,
            })

        # Task registry (covers all test-enabled entities)
        registry_ctx = tasks_registry_context(registry_infos, schema)
        _write(cypress_support / 'generated-tasks.ts',
               _render(env, 'test_tasks_registry.ts.jinja2', registry_ctx))

    # --- db-helpers.ts (always generated, not gated on test_entities) ---
    print('\nGenerating db-helpers.ts...')
    _write(out / 'cypress' / 'support' / 'db-helpers.ts',
           _render(env, 'test_db_helpers.ts.jinja2', db_ctx))

    # --- i18n / config updates ---
    print('\nUpdating i18n and navigation config...')
    update_i18n_and_config(entities, schema, out)

    # --- upload/route.ts (Vercel Blob, base default) ---
    # Always emitted so app/api/upload/route.ts is a full generated artifact
    # (manifest-tracked, cleanup-eligible) in both modes. x-cloud:gcp below
    # overwrites this with the GCS version when enabled (cmd_269/cmd_272).
    _write(
        out / 'app' / 'api' / 'upload' / 'route.ts',
        _render(env, 'upload_route_vercel.ts.jinja2', {}),
    )
    print('  Upload route (Vercel Blob) → app/api/upload/route.ts')

    # --- x-cloud opt-in: GCP Cloud Run artifacts ---
    if cloud_enabled and cloud_provider == 'gcp':
        print('\nGenerating GCP Cloud Run artifacts (x-cloud:gcp opt-in)...')

        # Dockerfile
        _write(out / 'Dockerfile', _render(env, 'Dockerfile.jinja2', {}))
        print('  Cloud: Dockerfile → Dockerfile')

        # .dockerignore
        _write(out / '.dockerignore', _render(env, '.dockerignore.jinja2', {}))
        print('  Cloud: .dockerignore → .dockerignore')

        # upload/route.ts — replace Vercel Blob with GCS
        _write(
            out / 'app' / 'api' / 'upload' / 'route.ts',
            _render(env, 'upload_route_gcs.ts.jinja2', {}),
        )
        print('  Cloud: GCS upload route → app/api/upload/route.ts')

        # GCS object serving route (V4 Signed URL proxy)
        gcs_serve_dir = out / 'app' / 'api' / 'gcs' / '[...path]'
        gcs_serve_dir.mkdir(parents=True, exist_ok=True)
        _write(
            gcs_serve_dir / 'route.ts',
            _render(env, 'gcs_serve_route.ts.jinja2', {}),
        )
        print('  Cloud: GCS serve route → app/api/gcs/[...path]/route.ts')

        # next.config.ts — add output: 'standalone'
        next_config_path = out / 'next.config.ts'
        if next_config_path.exists():
            content = next_config_path.read_text(encoding='utf-8')
            if "output: 'standalone'" not in content:
                content = content.replace(
                    'const nextConfig: NextConfig = {\n',
                    "const nextConfig: NextConfig = {\n  output: 'standalone',\n",
                )
                next_config_path.write_text(content, encoding='utf-8')
                print('  Cloud: added output:standalone → next.config.ts')
            else:
                print('  Cloud: output:standalone already present in next.config.ts')
        else:
            print('  Cloud: next.config.ts not found — skipping standalone injection')

    # --- generation manifest (drives cleanup.py) ---
    # Written last so it reflects exactly what this run produced. Appended files
    # touched by update_i18n_and_config above are intentionally not listed.
    manifest_path = _manifest.write(out, schema_path)
    print(f'\nWrote manifest: {manifest_path} ({len(_manifest)} files)')

    if _handwritten_notices:
        bar = '=' * 72
        print('\n' + bar)
        print('ACTION REQUIRED - hand-written files the generator cannot fill in')
        print(bar)
        print('New write-once stubs were created this run. They are NOT regenerated\n'
              'or overwritten, and cleanup never deletes them. Implement each one and\n'
              'commit it to version control so it survives a fresh rebuild:\n')
        for note in _handwritten_notices:
            print(note)
        print('\nSee docs/knowledge/code-generation-custom-extensions.md for the full list of extension points.')
        print(bar)

    print('\nCode generation complete!')


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python generate.py <schema.yaml> <output-dir>')
        print('Example: python generate.py ../../json_schema_db_table.yaml ../..')
        sys.exit(1)

    generate(sys.argv[1], sys.argv[2])
