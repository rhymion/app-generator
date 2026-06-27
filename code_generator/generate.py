#!/usr/bin/env python3
"""
generate.py — Full Python code generator (replaces generate.ts + templates.ts).

Usage:
    cd code_generator/py
    python generate.py ../../json_schema_db_table.yaml ../../

This is a drop-in replacement for:
    npx tsx code_generator/generate.ts <schema.yaml> .

"""
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
from generate_types import extract_entities, extract_named_constants
from context import build_entity_context
from build_context import build_context, _get_actual_type
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
from manifest import ManifestRecorder


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
    return env


# ---------------------------------------------------------------------------
# Bridge Prisma schema emission
# ---------------------------------------------------------------------------

def _collect_bridges(schema: dict) -> dict[str, dict]:
    """Collect all new-form x-bridge object declarations from the schema."""
    defs = schema.get('definitions', {})
    bridges: dict[str, dict] = {}
    for entity_name, entity_def in defs.items():
        if entity_name.endswith('_detail') or not isinstance(entity_def, dict):
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
    """Write stub only if file does not already exist (user may have customized)."""
    # Record the pristine stub content whether or not we (re)write it, so cleanup
    # can delete the file iff it still matches a pristine stub (i.e. untouched).
    _manifest.record(path, content, 'stub')
    if path.exists():
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

def _is_string_prop(prop: dict) -> bool:
    t = prop.get('type')
    if isinstance(t, str):
        return t == 'string'
    if isinstance(t, list):
        return 'string' in t and all(v in ('string', 'null') for v in t)
    return False


def _derive_text_fields(properties: dict) -> list[str]:
    """Auto-derive searchable text fields from entity properties.

    Excludes noise (id, FK, enum, CUID pattern, date/uri format, write-only)
    and per-field opt-outs (x-search: false).
    """
    result = []
    for field_name, prop in properties.items():
        if not isinstance(prop, dict):
            continue
        if not _is_string_prop(prop):
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


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def generate(schema_path: str, output_dir: str) -> None:
    with open(schema_path) as f:
        schema = yaml.safe_load(f)

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

    global _manifest
    _manifest = ManifestRecorder()
    _handwritten_notices.clear()

    env = _make_env()
    out = Path(output_dir)

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

        # --- virtual column resolver stub (per-entity, async/bulk) ---
        parent_pascal = to_pascal_case(parent)
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
        if can_new or can_edit or can_delete:
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
        if def_key.endswith('_detail'):
            continue
        x_approval = def_val.get('x-approval')
        if not x_approval:
            continue
        on_approved = x_approval.get('on_approved', {})
        entity_props = def_val.get('properties', {})
        resolved_sf = _resolve_set_fields(entity_props, on_approved.get('set_fields') or {})
        approvable_entities.append({
            'snake_name': def_key,
            'pascal_name': to_pascal_case(def_key),
            'set_fields': resolved_sf,
            'emit_hook': bool(on_approved.get('emit_hook', False)),
        })
    _write(
        out / 'lib' / 'approval_request' / 'on_approved_dispatch.ts',
        _render(env, 'on_approved_dispatch.ts.jinja2', {'approvable_entities': approvable_entities}),
    )
    print(f'  Approval dispatch → lib/approval_request/on_approved_dispatch.ts ({len(approvable_entities)} entities)')
    for ent in approvable_entities:
        if ent['emit_hook']:
            _write_stub(
                out / 'lib' / ent['snake_name'] / 'service_after_approve.ts',
                _render(env, 'service_after_approve_stub.ts.jinja2', ent),
            )
            print(f"  Approval stub → lib/{ent['snake_name']}/service_after_approve.ts")
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
        base_def   = schema['definitions'].get(model, {}) or {}

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

        # bigm_where_sql: ILIKE containment check (gin_bigm_ops accelerates ILIKE '%q%').
        # pg_bigm's =% operator uses padding bigrams and does NOT match mid-string Japanese
        # (e.g. '権限' =% '一般権限を...' → FALSE). ILIKE '%'||q||'%' correctly matches.
        # Replaces bigm_similarity()>0.2 which structurally fails for short Japanese queries
        # (Jaccard denominator grows with text length).
        # ILIKE: case-insensitive vs LIKE; pg_bigm supports ILIKE with GIN index.
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
        entity_names = ', '.join(e['entity_type'] for e in search_entities)
        print(f'  Search routes → lib/search/helpers.ts + app/api/search/route.ts ({entity_names})')
        print(f'  Search UI page → app/[locale]/search/page.tsx + actions.ts')
    else:
        # DP-2: no searchable entities — delete stale search files to prevent broken imports
        print('  Search: no searchable entities — skipping search route generation')
        _stale_search_files = [
            out / 'lib' / 'search' / 'helpers.ts',
            out / 'app' / 'api' / 'search' / 'route.ts',
            out / 'app' / '[locale]' / 'search' / 'page.tsx',
            out / 'app' / '[locale]' / 'search' / 'actions.ts',
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
    _test_entity_count = len(test_entities)
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
    _test_entity_names = sorted(e['parent'] for e in test_entities)
    db_ctx = db_helpers_context(schema, test_entity_names=_test_entity_names)
    _write(out / 'cypress' / 'support' / 'db-helpers.ts',
           _render(env, 'test_db_helpers.ts.jinja2', db_ctx))

    # --- i18n / config updates ---
    print('\nUpdating i18n and navigation config...')
    update_i18n_and_config(entities, schema, out)

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
        print('\nSee docs/extension-points.md for the full list of extension points.')
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
