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
from build_context import build_context
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
)
from validation_context import build_validation_context


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


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    print(f'  Wrote {path}')


def _write_stub(path: Path, content: str) -> bool:
    """Write stub only if file does not already exist (user may have customized).

    Returns True when a new blank stub was created (the user must implement it),
    False when an existing hand-written file was left untouched.
    """
    if path.exists():
        print(f'  Skipped (exists) {path}')
        return False
    _write(path, content)
    return True


# Collects reminders about write-once stubs the generator just created. These are
# hand-written extension points the generator cannot fill in; printed as an
# ACTION REQUIRED summary at the end of generate() and reset at its start.
_handwritten_notices: list[str] = []


def _note_stub_created(path: Path, why: str, action: str) -> None:
    _handwritten_notices.append(f'  - {path}\n      {why}\n      -> {action}')


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

    _handwritten_notices.clear()

    env = _make_env()
    out = Path(output_dir)

    # --- Bridge Prisma schema emission ---
    bridges = _collect_bridges(schema)
    if bridges:
        inject_bridge_into_schema(out / 'prisma' / 'schema.prisma', bridges)
        bridge_additions = build_bridge_prisma_additions(schema)
        _write(out / 'prisma' / 'bridge_additions.prisma', bridge_additions)
        print(f'  Bridge Prisma additions (reference) → prisma/bridge_additions.prisma')

    print(f'Found {len(entities)} entities in {schema_path}')

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
        ctx = build_context(entity, schema)

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
        _write(lib_dir / 'getters.ts', _render(env, 'getters.ts.jinja2', ctx))

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
                        _df_entries.append(
                            "{ field: '%s', headerName: tf('%s')%s }"
                            % (_fname, _fname, f', width: {_w}' if _w else '')
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
    named_constants = extract_named_constants(schema)
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
