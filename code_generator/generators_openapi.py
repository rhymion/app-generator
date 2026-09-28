"""generators_openapi.py — OpenAPI 3.1 build-artifact generation.

cmd_1154 (ai-agent-integration-design.md §2/§3/§7 Stage 1(a)); extended by
cmd_1198 (closing gaps 1-5 found by cmd_1194's investigation — list query
parameters, `readOnly`, bulk requestBody, 4xx responses, import/export
paths). Gap 6 (per-operation role/permission detail) is deliberately NOT
implemented here: the role/permission mapping is runtime database state
(`role`/`permission` rows), not something this static generator can read,
and expressing it here in any richer form than "a 403 is possible" would
require inventing a new vendor-extension key — a separate decision this
task's own scope defers rather than deciding unilaterally.

Produces a single OpenAPI 3.1 document (a plain Python dict, written via
json.dump — no new templating dialect) describing every `api: true`
entity's REST + bulk surface. Reuses json_schema.yaml's own field
definitions directly rather than inventing a second schema dialect: those
definitions are already JSON-Schema-draft-07-shaped (the `$schema` header
at the top of json_schema.yaml says so), and OpenAPI 3.1's schema object
IS JSON Schema 2020-12 by definition (design doc §6) — no dialect
translation is needed for the field-level keywords this module keeps.

Build artifact (design doc §3's exposure note): generate.py writes this
to docs/generated/openapi.json alongside the human-readable
doc_entity.md/page.mdx outputs. This module adds no API route and no new
schema key itself — but as of Issue #769, every generated app ships a
fixed (non-templated) route, `GET /api/openapi.json`
(app/api/openapi.json/route.ts in this repo), that serves this exact
file — API key or session required, in every environment including
production. See lib/openapi/document.ts and Issue #768 (the
development/staging-only Swagger UI page at /swagger, which reads its
spec from this same route rather than a second copy).

Scope, per the design doc's own static/runtime split (§3's table): field
type/required/enum, relationship shape (target + cardinality), and
export/import shape are schema-level and belong here. Row-level truth
(is *this* row's approval/lock/transition state currently permitting a
write) is deliberately NOT modeled here — that is a runtime capabilities
endpoint's job, not something a static spec can honestly claim to know.
"""

OPENAPI_VERSION = '3.1.0'

_READONLY_FIELDS = {'id', 'created_at', 'updated_at', 'creator_id'}

# Mirrors lib/_pagination.ts's own DEFAULT_PAGE_SIZE/MAX_PAGE_SIZE constants
# (cmd_1198) -- documented here, not imported, same "mirror the runtime
# constant" precedent _READONLY_FIELDS above already set.
_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 200

# The JSON-Schema/OpenAPI-standard keywords this module carries through
# from a field definition verbatim. Everything else (x-pii, x-relationship,
# x-generate, x-ui, ...) is this generator's own authoring-time annotation,
# not part of any JSON Schema/OpenAPI vocabulary, and is stripped so the
# spec doesn't leak internal schema-authoring metadata to an external
# consumer.
_STANDARD_SCHEMA_KEYS = {
    'type', 'format', 'enum', 'default', 'description', 'items',
    'minimum', 'maximum', 'minLength', 'maxLength', 'pattern',
    'uniqueItems', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum',
}

# cmd_1198 gap 4: real, cross-entity response text for each status code this
# generator ever declares. Every code below is backed by a template line
# read directly (see the module docstring's cmd_1198 note and this task's
# own report for citations) -- never guessed from the status code alone.
_RESPONSE_TEXT = {
    400: 'Bad request.',
    404: 'Not found.',
    409: 'Conflict — a unique-constraint violation, or a reservation/capacity conflict.',
    422: 'Unprocessable — one or more submitted fields failed validation.',
    429: 'Rate limited. See the Retry-After response header.',
}

_APIKEY_UNAUTHORIZED = 'Missing or invalid API key/bearer token.'
_DUALAUTH_UNAUTHORIZED = (
    'Authentication required — provide an X-API-Key/Authorization header '
    'or a valid session.'
)

# cmd_1198 gap 6 (the part that IS writable without a new x-* key, per this
# task's own boundary): which permission operation gates a 403 on this
# path. Plain description text, not a vendor extension -- the DB-driven
# role/permission grant itself is out of scope (see module docstring).
_PERMISSION_DESCRIPTIONS = {
    'read': "Forbidden — caller lacks the 'read' permission on this entity.",
    'create': "Forbidden — caller lacks the 'create' permission on this entity.",
    'update': "Forbidden — caller lacks the 'update' permission on this entity.",
    'delete': "Forbidden — caller lacks the 'delete' permission on this entity.",
    'import': "Forbidden — caller lacks the 'import' permission on this entity.",
}


def _clean_field_schema(defn: dict) -> dict:
    """Strip non-standard keys from one field definition, keep the rest.

    Falls back to `{'type': 'string'}` for a field def that (after
    stripping) carries no recognizable JSON Schema type information at
    all — a bare relation placeholder or similarly minimal declaration —
    rather than emitting an empty, meaningless `{}` schema object.
    """
    cleaned = {k: v for k, v in defn.items() if k in _STANDARD_SCHEMA_KEYS}
    return cleaned or {'type': 'string'}


def _record_properties(ctx: dict, all_props: dict) -> dict:
    """Full-record properties, each cleaned via `_clean_field_schema` and,
    for a system/server-managed field, marked `readOnly: true` (cmd_1198
    gap 2) -- JSON Schema 2020-12's own standard keyword for exactly
    "present on read, must not be sent on write", so a consumer reading
    only this schema (not cross-referencing the separate create-request
    schema) still gets the signal. Union of the four baseline system
    fields this module has always excluded from the create-request schema
    (`_READONLY_FIELDS`) and `ctx['readonly_fields']` (x-readonly /
    x-readonly-fields / x-server-value annotated fields, build_context.py)
    -- the same set doc_entity.md.jinja2's own Constraints section and
    the create-request schema below already treat as not client-writable.
    """
    readonly_names = _READONLY_FIELDS | set(ctx.get('readonly_fields') or [])
    properties = {}
    for name, defn in all_props.items():
        cleaned = _clean_field_schema(defn)
        if name in readonly_names:
            cleaned = {**cleaned, 'readOnly': True}
        properties[name] = cleaned
    return properties


def _relationship_shape(ctx: dict) -> list[dict]:
    """Relationship shape (design doc §3: "Relationship shape (FK target,
    cardinality)" is static-spec material) — carried as a vendor
    extension (`x-relationships`) per entity rather than a dereferenced
    `$ref` graph, so a consumer gets the FK target/cardinality without
    this module resolving cross-entity `$ref` cycles for a first version.
    """
    relations = []
    for r in ctx.get('parent_rels', []):
        relations.append({
            'field': r['prop_name'],
            'target': r['target'],
            'cardinality': 'many-to-one',
        })
    for child in ctx.get('children_raw', []):
        rel = child.get('relationship') or {}
        relations.append({
            'field': child['property_name'],
            'target': child['name'],
            'cardinality': rel.get('type', 'one-to-many'),
        })
    return relations


def _param_schema_for_field(field: str, record_properties: dict) -> dict:
    """The query-parameter value schema for one sort/filter field --
    reuses the SAME cleaned field schema the record schema itself carries
    (cmd_1198 gap 1), so a filter param's declared type can never drift
    from the field's own declared type. `id`/`created_at`/`updated_at`/
    `creator_id`/`assignee_id` are always sort/filterable
    (build_context.py's `_scalar_props`) even though the first four are
    never actual json_schema.yaml properties (they're pure Prisma-level
    base fields) -- `record_properties` won't have an entry for them, so
    a small, explicit fallback covers exactly that gap.
    """
    if field in record_properties:
        # readOnly (gap 2) is a response/record-schema concept -- stripped
        # here since it has no meaning on a request query parameter.
        return {k: v for k, v in record_properties[field].items() if k != 'readOnly'}
    if field in ('created_at', 'updated_at'):
        return {'type': 'string', 'format': 'date-time'}
    return {'type': 'string'}  # id / creator_id / assignee_id: opaque id strings


def _filter_match_description(kind: str) -> str:
    """What `f.<field>=value` actually matches against, per column kind
    (`lib/_pagination.ts`'s `buildFilter`, current `develop` behavior).
    Deliberately does NOT describe per-kind operator selection
    (is/not/isAnyOf/after/...) -- that is app-generator#756's
    DataGridClient-only Server Action path (its own
    docs/knowledge/list-filter-sort-typed-columns.md design), which
    `parsePageOpts()` (the REST query-string path this parameter
    documents) does not receive even once #756 merges (`FilterMap`'s
    bare-scalar REST shape is unchanged by that change) -- describing an
    operator here would claim a REST capability that route never gains.
    """
    if kind == 'string':
        return "Filters via a case-insensitive substring match ('contains')."
    return "Filters via an exact match ('equals')."


def _list_query_parameters(ctx: dict, record_properties: dict) -> list[dict]:
    """`page`/`pageSize`/`sort`/`f.<field>` parameters for `GET
    /api/{parent}` (cmd_1198 gap 1) -- built from the exact same
    sort/filter allow-list and per-column kind map getters.ts.jinja2's
    generated `SORTABLE_FIELDS`/`FILTERABLE_FIELDS`/`FIELD_KINDS` render
    from (`ctx['sort_filter_fields']`/`ctx['sort_filter_field_kinds']`,
    build_context.py), so this can't silently drift from what the real
    route actually accepts.
    """
    sort_fields: list[str] = list(ctx.get('sort_filter_fields') or [])
    relation_fields: list[tuple[str, str]] = list(ctx.get('sort_filter_relation_fields') or [])
    kinds: dict = ctx.get('sort_filter_field_kinds') or {}

    params = [
        {
            'name': 'page', 'in': 'query', 'required': False,
            'schema': {'type': 'integer', 'minimum': 0, 'default': 0},
            'description': 'Zero-based page index.',
        },
        {
            'name': 'pageSize', 'in': 'query', 'required': False,
            'schema': {
                'type': 'integer', 'minimum': 1,
                'maximum': _MAX_PAGE_SIZE, 'default': _DEFAULT_PAGE_SIZE,
            },
            'description': f'Rows per page. A value above {_MAX_PAGE_SIZE} returns 400.',
        },
    ]

    sortable_names = sorted(set(sort_fields) | {r for r, _ in relation_fields})
    if sortable_names:
        params.append({
            'name': 'sort', 'in': 'query', 'required': False,
            'schema': {'type': 'string'},
            'description': (
                "Comma-separated 'field:dir' pairs (dir is 'asc' or 'desc', "
                "default 'asc' when omitted); a field outside the allow-list "
                f"below is silently ignored. Sortable fields: {', '.join(sortable_names)}."
            ),
        })

    for field in sort_fields:
        params.append({
            'name': f'f.{field}', 'in': 'query', 'required': False,
            'schema': _param_schema_for_field(field, record_properties),
            'description': f'Filter on {field!r}. {_filter_match_description(kinds.get(field, "string"))}',
        })
    for rel_field, label_field in relation_fields:
        params.append({
            'name': f'f.{rel_field}', 'in': 'query', 'required': False,
            'schema': {'type': 'string'},
            'description': (
                f"Filter {rel_field!r} by the related row's {label_field!r} "
                "column. Filters via a case-insensitive substring match ('contains')."
            ),
        })
    return params


def _std_responses(
    error_ref: dict, *, permission: str, codes: list[int],
    unauthorized_description: str = _APIKEY_UNAUTHORIZED,
) -> dict:
    """Build the `{code: response}` map for a list of non-2xx/non-207
    status codes this operation can really return (cmd_1198 gap 4) --
    every caller-supplied `codes` entry is one this module's own report
    traced to a real, unconditional-or-ctx-gated line in the relevant
    api_*.ts.jinja2/service.ts.jinja2 template, never assumed from the
    status code's generic meaning alone.
    """
    responses = {}
    for code in sorted(codes):
        if code == 401:
            text = unauthorized_description
        elif code == 403:
            text = _PERMISSION_DESCRIPTIONS[permission]
        else:
            text = _RESPONSE_TEXT[code]
        responses[str(code)] = {
            'description': text,
            'content': {'application/json': {'schema': error_ref}},
        }
    return responses


def build_entity_openapi(ctx: dict) -> dict:
    """Per-entity OpenAPI material: one component schema (full record),
    one create-request schema (writable fields only), and the path items
    for whichever operations this entity's x-generate config enables.

    Returns {} for an entity with `api: false` — it has no REST surface
    for a spec to describe at all (mirrors doc_entity.md.jinja2's own
    `can_api` gate).
    """
    if not ctx.get('can_api'):
        return {}

    parent = ctx['parent']
    parent_pascal = ctx['parent_pascal']
    model_def = ctx['model_def']
    all_props = model_def.get('properties', {})
    required_fields = set(model_def.get('required') or [])
    filtered_props = ctx['filtered_props']

    record_properties = _record_properties(ctx, all_props)
    record_schema: dict = {
        'type': 'object',
        'properties': record_properties,
    }
    if required_fields:
        record_schema['required'] = sorted(required_fields)
    relationships = _relationship_shape(ctx)
    if relationships:
        record_schema['x-relationships'] = relationships

    # Approval flow / write-lock capability (cmd_1154, design doc §3's
    # table): both are entity-level, static facts -- true for every row
    # of this entity regardless of its current data -- as distinct from
    # the row-level "is THIS row submittable/locked right now" question
    # the table deliberately leaves to a runtime endpoint. Carried as
    # vendor extensions, reusing the exact same ctx keys doc_entity.md.
    # jinja2's Constraints section renders from, so the two static-spec
    # outputs (human doc, machine spec) never drift into disagreeing
    # about what "approval-governed"/"write-locked" means for a schema.
    if ctx.get('is_approvable') and ctx.get('approval_config'):
        _appr = ctx['approval_config']
        record_schema['x-approval'] = {
            'submit_field': _appr.get('submit_field'),
            'submit_value': _appr.get('submit_value'),
            'on_approved_set_fields': _appr.get('on_approved_set_fields'),
            'on_rejected_set_fields': _appr.get('on_rejected_set_fields'),
            'on_rejected_terminal': _appr.get('on_rejected_terminal', False),
            'on_withdrawn_set_fields': _appr.get('on_withdrawn_set_fields'),
        }
    if ctx.get('write_locked_values'):
        record_schema['x-write-locked-values'] = ctx['write_locked_values']

    create_properties = {
        name: _clean_field_schema(defn)
        for name, defn in filtered_props.items()
        if name not in _READONLY_FIELDS
    }
    create_required = sorted(f for f in required_fields if f in create_properties)
    create_schema: dict = {
        'type': 'object',
        'properties': create_properties,
    }
    if create_required:
        create_schema['required'] = create_required

    schema_name = parent_pascal
    create_schema_name = f'{parent_pascal}CreateRequest'
    bulk_update_schema_name = f'{parent_pascal}BulkUpdateItem'
    record_ref = {'$ref': f'#/components/schemas/{schema_name}'}
    create_ref = {'$ref': f'#/components/schemas/{create_schema_name}'}
    bulk_update_ref = {'$ref': f'#/components/schemas/{bulk_update_schema_name}'}
    error_ref = {'$ref': '#/components/schemas/Error'}
    bulk_result_ref = {'$ref': '#/components/schemas/BulkResult'}
    import_result_ref = {'$ref': '#/components/schemas/ImportResult'}

    tag = parent
    paths: dict = {}
    schemas: dict = {schema_name: record_schema, create_schema_name: create_schema}

    if ctx.get('can_list') or ctx.get('can_create'):
        list_item: dict = {}
        if ctx.get('can_list'):
            list_item['get'] = {
                'tags': [tag],
                'summary': f'List {parent}',
                'parameters': _list_query_parameters(ctx, record_properties),
                'responses': {
                    '200': {
                        'description': 'OK',
                        'content': {
                            'application/json': {
                                'schema': {'type': 'array', 'items': record_ref},
                            },
                        },
                    },
                    # gap 4: pageSize>MAX_PAGE_SIZE -> 400 (api_route.ts.jinja2,
                    # unconditional); auth/permission/rate-limit are likewise
                    # unconditional on every GET.
                    **_std_responses(error_ref, permission='read', codes=[400, 401, 403, 429]),
                },
            }
        if ctx.get('can_create'):
            _create_codes = [401, 403, 409, 422, 429]
            if ctx.get('readonly_fields_create_reject'):
                # AP-3 create-time reject (api_route.ts.jinja2): only emitted
                # when this entity actually has a plain-readonly field to
                # reject -- not every entity does.
                _create_codes.append(400)
            list_item['post'] = {
                'tags': [tag],
                'summary': f'Create a {parent}',
                'requestBody': {
                    'required': True,
                    'content': {'application/json': {'schema': create_ref}},
                },
                'responses': {
                    '201': {
                        'description': 'Created',
                        'content': {'application/json': {'schema': record_ref}},
                    },
                    # gap 4: 409 (P2002 unique-constraint) / 422 (VALIDATION
                    # catch-all) are unconditional in service.ts.jinja2's
                    # add{Parent}, for every entity (this task's own report
                    # cites the exact lines) -- not gated on any per-entity
                    # config.
                    **_std_responses(error_ref, permission='create', codes=_create_codes),
                },
            }
        paths[f'/api/{parent}'] = list_item

    if ctx.get('can_view') or ctx.get('can_update') or ctx.get('can_delete'):
        detail_item: dict = {
            'parameters': [
                {'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'string'}},
            ],
        }
        if ctx.get('can_view'):
            detail_item['get'] = {
                'tags': [tag],
                'summary': f'Get a {parent} by id',
                'responses': {
                    '200': {'description': 'OK', 'content': {'application/json': {'schema': record_ref}}},
                    **_std_responses(error_ref, permission='read', codes=[401, 403, 404, 429]),
                },
            }
        if ctx.get('can_update'):
            _update_codes = [401, 403, 404, 409, 422, 429]
            if ctx.get('readonly_fields_api'):
                # AP-3=B PUT-time readonly-mismatch reject (api_detail_route.
                # ts.jinja2) -- only when this entity has an API-visible
                # readonly field to compare against.
                _update_codes.append(400)
            detail_item['put'] = {
                'tags': [tag],
                'summary': f'Replace a {parent}',
                'requestBody': {
                    'required': True,
                    'content': {'application/json': {'schema': create_ref}},
                },
                'responses': {
                    '200': {'description': 'OK'},
                    # gap 4: 409/422 same as create's add{Parent} --
                    # update{Parent} (service.ts.jinja2) carries the
                    # identical unconditional P2002/VALIDATION catch.
                    **_std_responses(error_ref, permission='update', codes=_update_codes),
                },
            }
        if ctx.get('can_delete'):
            _delete_codes = [401, 403, 404, 429]
            if (ctx.get('reservation_config') or {}).get('mode') == 'count':
                # ReservationMutationError -> 409 (api_detail_route.ts.jinja2's
                # DELETE catch) -- only wired for count-mode reservation entities.
                _delete_codes.append(409)
            detail_item['delete'] = {
                'tags': [tag],
                'summary': f'Delete a {parent}',
                'responses': {
                    '204': {'description': 'No content'},
                    **_std_responses(error_ref, permission='delete', codes=_delete_codes),
                },
            }
        paths[f'/api/{parent}/{{id}}'] = detail_item

    bulk_item: dict = {}
    bulk_response = {
        '207': {
            'description': 'Multi-Status — per-item results, partial success',
            'content': {'application/json': {'schema': bulk_result_ref}},
        },
    }
    # gap 4: every bulk operation (api_bulk_route.ts.jinja2) is
    # auth/permission/rate-limit gated at the top of the request exactly
    # like its singular counterpart, but every per-item outcome (not-found,
    # access-denied, or the write itself failing) is caught row-by-row and
    # reported INSIDE the 207 body's `results[]`/`errors[]` -- never
    # re-thrown as a top-level 400/404/409/422. So bulk's own top-level
    # error surface is strictly narrower than its singular counterpart.
    if ctx.get('can_create'):
        bulk_item['post'] = {
            'tags': [tag],
            'summary': f'Bulk-create {parent}',
            'requestBody': {
                'required': True,
                'content': {'application/json': {'schema': {'type': 'array', 'items': create_ref}}},
            },
            'responses': {
                **bulk_response,
                **_std_responses(error_ref, permission='create', codes=[401, 403, 429]),
            },
        }
    if ctx.get('can_update'):
        # gap 3: bulk PUT (api_bulk_route.ts.jinja2) destructures
        # `{ id, ...create-fields }` per item -- the create-request shape
        # plus a required `id` naming which row to update.
        schemas[bulk_update_schema_name] = {
            'type': 'object',
            'properties': {'id': {'type': 'string'}, **create_properties},
            'required': ['id'],
        }
        bulk_item['put'] = {
            'tags': [tag],
            'summary': f'Bulk-update {parent}',
            'requestBody': {
                'required': True,
                'content': {'application/json': {'schema': {'type': 'array', 'items': bulk_update_ref}}},
            },
            'responses': {
                **bulk_response,
                **_std_responses(error_ref, permission='update', codes=[401, 403, 429]),
            },
        }
    if ctx.get('can_delete'):
        # gap 3: bulk DELETE (api_bulk_route.ts.jinja2) reads only `id` per item.
        bulk_item['delete'] = {
            'tags': [tag],
            'summary': f'Bulk-delete {parent}',
            'requestBody': {
                'required': True,
                'content': {'application/json': {'schema': {
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'properties': {'id': {'type': 'string'}},
                        'required': ['id'],
                    },
                }}},
            },
            'responses': {
                **bulk_response,
                **_std_responses(error_ref, permission='delete', codes=[401, 403, 429]),
            },
        }
    if bulk_item:
        paths[f'/api/{parent}/bulk'] = bulk_item

    # gap 5: CSV export/import paths (generate.py's own gating conditions,
    # mirrored exactly -- `can_list and can_export` / `import_eligible`).
    # Neither route calls getRateLimiter() (api_export_route.ts.jinja2,
    # api_import_route.ts.jinja2 -- confirmed absent, unlike every other
    # route above), so neither gets a 429; both use resolveActorId's
    # dual-auth (session OR API key), so their 401 text differs from the
    # API-key-only routes above.
    if ctx.get('can_list') and ctx.get('can_export'):
        paths[f'/api/{parent}/export'] = {
            'get': {
                'tags': [tag],
                'summary': f'Export {parent} as CSV',
                'responses': {
                    '200': {
                        'description': 'CSV stream (UTF-8 BOM + header row).',
                        'content': {'text/csv': {'schema': {'type': 'string'}}},
                    },
                    **_std_responses(
                        error_ref, permission='read', codes=[401, 403],
                        unauthorized_description=_DUALAUTH_UNAUTHORIZED,
                    ),
                },
            },
        }
    if ctx.get('import_eligible'):
        schemas['ImportResult'] = _IMPORT_RESULT_SCHEMA
        paths[f'/api/{parent}/import'] = {
            'post': {
                'tags': [tag],
                'summary': f'Import {parent} from CSV',
                'requestBody': {
                    'required': True,
                    'content': {'application/json': {'schema': {
                        'type': 'object',
                        'properties': {
                            'csv': {'type': 'string', 'description': 'Raw CSV text, header row required.'},
                            'dryRun': {
                                'type': 'boolean', 'default': True,
                                'description': (
                                    'Validate only when true (the default). Set false, with the '
                                    'confirmToken a prior dryRun=true call returned, to commit.'
                                ),
                            },
                            'confirmToken': {
                                'type': 'string',
                                'description': 'Returned by a dryRun=true call; required to commit.',
                            },
                        },
                        'required': ['csv'],
                    }}},
                },
                'responses': {
                    '200': {
                        'description': (
                            'Validated (dryRun) or committed. Per-row failures are reported in '
                            "the body's errors[] array, not via HTTP status."
                        ),
                        'content': {'application/json': {'schema': import_result_ref}},
                    },
                    '400': {
                        'description': (
                            'Structural failure: oversized file, too many rows, a missing key '
                            'column, or an expired/invalid confirmToken.'
                        ),
                        'content': {'application/json': {'schema': import_result_ref}},
                    },
                    **_std_responses(
                        error_ref, permission='import', codes=[401, 403],
                        unauthorized_description=_DUALAUTH_UNAUTHORIZED,
                    ),
                },
            },
        }

    return {
        'schemas': schemas,
        'paths': paths,
        'tag': tag,
    }


# cmd_1198 gap 5: shared ImportResult shape (api_import_route.ts.jinja2's own
# `ImportResult` TS type) -- identical across every importable entity, so
# it's defined once here rather than duplicated per-entity in
# build_entity_openapi() above.
_IMPORT_RESULT_SCHEMA = {
    'type': 'object',
    'properties': {
        'summary': {
            'type': 'object',
            'properties': {
                'total': {'type': 'integer'},
                'succeeded': {'type': 'integer'},
                'failed': {'type': 'integer'},
                'dryRun': {'type': 'boolean'},
            },
            'required': ['total', 'succeeded', 'failed', 'dryRun'],
        },
        'errors': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'row': {'type': 'integer'},
                    'code': {'type': 'string'},
                    'message': {'type': 'string'},
                },
                'required': ['row', 'code', 'message'],
            },
        },
        'confirmToken': {'type': 'string'},
        'skippedColumns': {'type': 'array', 'items': {'type': 'string'}},
    },
    'required': ['summary', 'errors'],
}


def assemble_openapi_document(entity_specs: list[dict]) -> dict:
    """Merge every entity's build_entity_openapi() output into one OpenAPI
    3.1 document. Entries that are `{}` (api:false entities) are skipped.
    """
    schemas: dict = {
        'Error': {
            'type': 'object',
            'properties': {'error': {'type': 'string'}},
            'required': ['error'],
        },
        'BulkResult': {
            'type': 'object',
            'properties': {
                'results': {
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'index': {'type': 'integer'},
                            'success': {'type': 'boolean'},
                            'data': {},
                            'error': {'type': 'string'},
                        },
                        'required': ['index', 'success'],
                    },
                },
                'summary': {
                    'type': 'object',
                    'properties': {
                        'total': {'type': 'integer'},
                        'succeeded': {'type': 'integer'},
                        'failed': {'type': 'integer'},
                    },
                    'required': ['total', 'succeeded', 'failed'],
                },
            },
            'required': ['results', 'summary'],
        },
    }
    paths: dict = {}
    tags: list = []
    for spec in entity_specs:
        if not spec:
            continue
        schemas.update(spec['schemas'])
        paths.update(spec['paths'])
        if spec['tag'] not in tags:
            tags.append(spec['tag'])

    return {
        'openapi': OPENAPI_VERSION,
        'info': {
            'title': 'Generated API',
            'version': '1.0.0',
            'description': (
                "Machine-readable spec of this application's REST API, "
                'generated from json_schema.yaml. Served at GET '
                '/api/openapi.json (API key or session required) in every '
                'environment, including production. This document '
                "describes which endpoints exist and their request/response "
                "shapes; it does not describe what a caller can do to a "
                "specific record right now (write locks, state transitions, "
                'approval actions) — see GET '
                "/api/{entity}/{id}/capabilities for that."
            ),
        },
        'tags': [{'name': t} for t in tags],
        'components': {
            'schemas': schemas,
            'securitySchemes': {
                'ApiKeyHeader': {'type': 'apiKey', 'in': 'header', 'name': 'X-API-Key'},
                'ApiKeyBearer': {'type': 'http', 'scheme': 'bearer'},
            },
        },
        'security': [{'ApiKeyHeader': []}, {'ApiKeyBearer': []}],
        'paths': paths,
    }
