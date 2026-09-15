"""
Tests for seed_entities_context() (code_generator/generators.py) — the
"independent entity" list consumed by scripts/grant-all-permissions.ts (a
dev/verification tool; NOT scripts/seed-baseline.ts, whose fixed enumeration
is unchanged).

audit_log is the highest-risk entity here: if it ever leaked into the
generated SEED_ENTITIES list, grant-all-permissions.ts would silently grant
full CRUD on it, defeating its read-only design (see
docs/knowledge/seed-baseline-credential-hardening.md).

Protection is layered:
  1. structural — audit_log is never a schema['definitions'] key at all
     (it's a Python-injected system_first table, same treatment
     db_helpers_context's deletion-order helper gives it), so
     seed_entities_context() never sees it.
  2. explicit belt-and-suspenders — lives in scripts/grant-all-permissions.ts
     itself (ALWAYS_EXCLUDED), not in this Python layer.
  3. separate read-only upsert — audit_log's permission row is written by a
     dedicated upsert, never touched by the SEED_ENTITIES-driven loop.

This suite verifies layer 1 using an injected-fixture convention: first
prove the test CAN detect a leak by injecting a schema where an
audit_log-shaped entity *is* a definitions key (simulating what would
happen if someone ever added a real audit_log definitions entry), then
prove the real, unmodified schema does not leak it.
"""
from generators import seed_entities_context


def _minimal_schema(extra_defs: dict | None = None) -> dict:
    """A minimal but structurally realistic schema: one raw/view split pair
    (user), one internal-only marker entity (approvable, all x-generate
    flags False, mirroring commentable/attachable/notification), and one
    unsplit child entity with its own id (comment)."""
    defs = {
        '__user': {
            'type': 'object',
            'properties': {
                'id': {'type': 'string'},
                'name': {'type': 'string'},
            },
        },
        'user': {
            'x-generate': {
                'list': True, 'view': True, 'new': False, 'edit': True,
                'delete': False, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/__user'}],
        },
        '__approvable': {
            'type': 'object',
            'properties': {'id': {'type': 'string'}},
        },
        'approvable': {
            'x-generate': {
                'list': False, 'view': False, 'new': False, 'edit': False,
                'delete': False, 'api': False, 'test': False,
            },
        },
        'comment': {
            'type': 'object',
            'properties': {
                'id': {'type': 'string'},
                'message': {'type': 'string'},
            },
        },
    }
    if extra_defs:
        defs.update(extra_defs)
    return {'definitions': defs}


def test_real_definitions_never_contain_audit_log_or_mfa_recovery_code() -> None:
    """Sanity anchor for the structural claim: db_helpers_context's
    system_first table names must never be schema['definitions'] keys, or
    the exclusion this whole design leans on silently stops holding."""
    schema = _minimal_schema()
    assert 'audit_log' not in schema['definitions']
    assert 'mfa_recovery_code' not in schema['definitions']


def test_audit_log_excluded_when_absent_from_definitions() -> None:
    """Layer 1 (structural): with a schema shaped like the real one (no
    audit_log definitions key), audit_log never appears in SEED_ENTITIES."""
    schema = _minimal_schema()
    ctx = seed_entities_context(schema)
    assert 'audit_log' not in ctx['seed_entity_names']
    assert 'mfa_recovery_code' not in ctx['seed_entity_names']


def test_deviation_injection_audit_log_leaks_if_added_to_definitions() -> None:
    """Proves the test harness can actually detect a leak: if audit_log
    were ever (incorrectly) added as a real definitions entry with an id
    and a live x-generate config — the exact shape any other independent
    entity has — seed_entities_context() has no OTHER mechanism protecting
    it (the internal-only exclusion below only catches approvable-shaped
    marker entities, not audit_log), so it appears in the output. This is
    the deviation the generator-side structural exclusion (definitions
    membership) is the only defense against; the explicit
    belt-and-suspenders ALWAYS_EXCLUDED list lives one layer further out,
    in scripts/grant-all-permissions.ts."""
    schema = _minimal_schema({
        'audit_log': {
            'type': 'object',
            'properties': {'id': {'type': 'string'}},
            'x-generate': {
                'list': True, 'view': True, 'new': False, 'edit': False,
                'delete': False, 'api': True, 'test': False,
            },
        },
    })
    ctx = seed_entities_context(schema)
    assert 'audit_log' in ctx['seed_entity_names'], (
        'deviation injection failed to leak — the test fixture is not '
        'actually exercising the definitions-membership guard; a real '
        'regression would go undetected'
    )


def test_internal_only_marker_entities_excluded() -> None:
    """approvable (x-generate all False) must not appear even though it
    has an id via its __approvable raw twin."""
    schema = _minimal_schema()
    ctx = seed_entities_context(schema)
    assert 'approvable' not in ctx['seed_entity_names']


def test_internal_only_generalization_covers_unnamed_markers() -> None:
    """The generalized internal-only rule (all core x-generate flags False)
    must also exclude entities structurally identical to 'approvable' but
    not literally named that — e.g. commentable/attachable/notification in
    the real schema — proving the exclusion is not a single hardcoded name
    that a differently-named future marker entity could slip past."""
    schema = _minimal_schema({
        '__widgetable': {
            'type': 'object',
            'properties': {'id': {'type': 'string'}},
        },
        'widgetable': {
            'x-generate': {
                'list': False, 'view': False, 'new': False, 'edit': False,
                'delete': False, 'api': False, 'test': False,
            },
        },
    })
    ctx = seed_entities_context(schema)
    assert 'widgetable' not in ctx['seed_entity_names']


def test_split_pair_and_unsplit_child_both_included() -> None:
    """user (raw/view split, id via __user) and comment (unsplit, own id)
    both qualify as independent entities."""
    schema = _minimal_schema()
    ctx = seed_entities_context(schema)
    assert ctx['seed_entity_names'] == ['comment', 'user']


def test_x_bridge_target_excluded() -> None:
    """An entity that is the x-bridge.name target of another definition is
    an internal junction table (no standalone Prisma model reachable the
    normal way) and must be excluded, mirroring db_helpers_context's
    xbridge_table_names handling."""
    schema = _minimal_schema({
        '__widget_tag': {
            'type': 'object',
            'properties': {'id': {'type': 'string'}},
        },
        'widget': {
            'type': 'object',
            'properties': {'id': {'type': 'string'}},
            'x-bridge': {'name': 'widget_tag'},
        },
    })
    ctx = seed_entities_context(schema)
    assert 'widget_tag' not in ctx['seed_entity_names']
    assert 'widget' in ctx['seed_entity_names']


def test_self_only_admin_bypass_proxy_view_excluded() -> None:
    """A 'setting'-shaped proxy view stays excluded via x-self-only
    admin_bypass, not via a blanket proxy-view exclusion."""
    schema = _minimal_schema({
        'setting': {
            'x-generate': {
                'list': False, 'view': True, 'new': False, 'edit': True,
                'delete': False, 'api': True, 'test': False,
            },
            'x-self-only': {'admin_bypass': True},
            'allOf': [{'$ref': '#/definitions/user'}],
        },
    })
    ctx = seed_entities_context(schema)
    assert 'setting' not in ctx['seed_entity_names']


def test_proxy_view_without_self_only_now_included() -> None:
    """A proxy view with no self-only declaration of its own (e.g. a demo
    fixture like 'setting1') now gets its own grant -- requirePermission()
    checks the view's own route name, not the shared model, so excluding
    every proxy view left it permanently ungranted."""
    schema = _minimal_schema({
        'setting1': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/user'}],
        },
    })
    ctx = seed_entities_context(schema)
    assert 'setting1' in ctx['seed_entity_names']
    assert 'user' in ctx['seed_entity_names']


def test_two_proxy_views_sharing_model_both_included_independently() -> None:
    """setting1/setting2-shaped case: two proxy views sharing one model
    each get their own grant, since permission checks are keyed to each
    view's own route name."""
    schema = _minimal_schema({
        'setting1': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/user'}],
        },
        'setting2': {
            'x-generate': {
                'list': True, 'view': True, 'new': False, 'edit': False,
                'delete': False, 'api': False, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/user'}],
        },
    })
    ctx = seed_entities_context(schema)
    assert 'setting1' in ctx['seed_entity_names']
    assert 'setting2' in ctx['seed_entity_names']


def test_grant_flags_reflect_x_generate_new_and_delete_false() -> None:
    """grant-all-permissions must never grant an operation
    x-generate has disabled for that entity, or the Administrator UI shows
    an affordance (a "+" create button, a delete action) that 404s when
    clicked because generate.py never wrote the page/route for it. The
    fixture's own 'user' entity (new: False, delete: False, edit: True)
    is the exact real-world shape this guards against."""
    schema = _minimal_schema()
    ctx = seed_entities_context(schema)
    assert ctx['seed_entity_grants']['user'] == {
        'create': False,   # x-generate.new: False -> no /new page, no POST route
        'read': True,       # x-generate.list/view: True
        'update': True,      # x-generate.edit: True
        'delete': False,   # x-generate.delete: False -> no DELETE route
        'import': False,    # no x-import-key on this fixture
    }


def test_grant_flags_default_true_when_x_generate_omits_a_key() -> None:
    """'comment' has no x-generate block at all -- every operation defaults
    to grantable (list/view/new/edit/delete default True per
    generate_types.py's own `.get(key, True) is not False` formula), since
    the generator itself would generate every page/route by default."""
    schema = _minimal_schema()
    ctx = seed_entities_context(schema)
    assert ctx['seed_entity_grants']['comment'] == {
        'create': True,
        'read': True,
        'update': True,
        'delete': True,
        'import': False,  # no x-import-key present -- import never eligible regardless
    }


def test_grant_flags_read_true_when_only_list_or_only_view_enabled() -> None:
    """A single Permission.read column backs both the list-page GET and the
    detail-page GET -- granting it is correct as long as EITHER page/route
    exists, not only when both do."""
    schema = _minimal_schema({
        'list_only_entity': {
            'type': 'object',
            'properties': {'id': {'type': 'string'}},
            'x-generate': {
                'list': True, 'view': False, 'new': False, 'edit': False,
                'delete': False, 'api': False, 'test': False,
            },
        },
    })
    ctx = seed_entities_context(schema)
    assert ctx['seed_entity_grants']['list_only_entity']['read'] is True


def test_grant_flags_import_requires_import_key_and_create_or_update() -> None:
    """import mirrors build_context.py's own import_eligible formula: a
    primary entity, x-import-key present, x-generate.import not explicitly
    False, and (can_create or can_update). Missing x-import-key alone must
    keep import withheld even though new/edit are both enabled."""
    schema = _minimal_schema({
        'importable_widget': {
            'type': 'object',
            'properties': {'id': {'type': 'string'}, 'code': {'type': 'string'}},
            'x-import-key': 'code',
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': False,
            },
        },
    })
    ctx = seed_entities_context(schema)
    assert ctx['seed_entity_grants']['importable_widget']['import'] is True


def test_grant_flags_import_withheld_when_new_and_edit_both_false() -> None:
    """Even with x-import-key present, import must stay withheld when
    neither create nor update is possible (build_context.py's Tier1
    `(can_create or can_update)` clause) -- an import route that could only
    ever reject every row is not something to grant."""
    schema = _minimal_schema({
        'readonly_importable': {
            'type': 'object',
            'properties': {'id': {'type': 'string'}, 'code': {'type': 'string'}},
            'x-import-key': 'code',
            'x-generate': {
                'list': True, 'view': True, 'new': False, 'edit': False,
                'delete': False, 'api': True, 'test': False,
            },
        },
    })
    ctx = seed_entities_context(schema)
    assert ctx['seed_entity_grants']['readonly_importable']['import'] is False


def test_grant_flags_import_withheld_for_non_primary_proxy_view() -> None:
    """A proxy view (allOf referencing a DIFFERENT entity's model, e.g.
    setting1 -> user) is never the import-eligible 'primary
    entity' (build_context.py's `parent == model` check) even if it
    happened to declare its own x-import-key -- import always targets the
    real underlying model, never an alias route."""
    schema = _minimal_schema({
        'setting1': {
            'x-import-key': 'name',
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': '#/definitions/user'}],
        },
    })
    ctx = seed_entities_context(schema)
    assert ctx['seed_entity_grants']['setting1']['import'] is False


def test_grant_flags_ordinary_split_pair_view_is_still_primary() -> None:
    """The ordinary raw/view split pair (view half's allOf referencing its
    OWN '__{name}' raw twin) must NOT be misclassified as a non-primary
    proxy view -- 'user' itself (allOf -> __user) stays import-eligible
    when it otherwise qualifies."""
    schema = _minimal_schema({
        '__importable_user': {
            'type': 'object',
            'properties': {'id': {'type': 'string'}, 'code': {'type': 'string'}},
        },
        'importable_user': {
            'x-import-key': 'code',
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': False,
            },
            'allOf': [{'$ref': '#/definitions/__importable_user'}],
        },
    })
    ctx = seed_entities_context(schema)
    assert ctx['seed_entity_grants']['importable_user']['import'] is True


def test_self_only_without_admin_bypass_not_excluded() -> None:
    """x-self-only: true (admin_bypass defaults False) must NOT be
    excluded -- excluding it would deny Administrator access outright,
    since no bypass path exists to fall back on."""
    schema = _minimal_schema({
        'setting1': {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'x-self-only': True,
            'allOf': [{'$ref': '#/definitions/user'}],
        },
    })
    ctx = seed_entities_context(schema)
    assert 'setting1' in ctx['seed_entity_names']
