"""generators_openapi.py — OpenAPI 3.1 build-artifact generation.

cmd_1154 (ai-agent-integration-design.md §2/§3/§7 Stage 1(a)).

Produces a single OpenAPI 3.1 document (a plain Python dict, written via
json.dump — no new templating dialect) describing every `api: true`
entity's REST + bulk surface. Reuses json_schema.yaml's own field
definitions directly rather than inventing a second schema dialect: those
definitions are already JSON-Schema-draft-07-shaped (the `$schema` header
at the top of json_schema.yaml says so), and OpenAPI 3.1's schema object
IS JSON Schema 2020-12 by definition (design doc §6) — no dialect
translation is needed for the field-level keywords this module keeps.

Build artifact only (design doc §3's exposure note): generate.py just
writes this to docs/generated/openapi.json alongside the human-readable
doc_entity.md/page.mdx outputs — the same "build-time output, not a
runtime route" treatment those already get. This module adds no API
route and no new schema key; a deployed app does not serve this file
unless a customer wires up their own route to do so.

Scope, per the design doc's own static/runtime split (§3's table): field
type/required/enum, relationship shape (target + cardinality), and
export/import shape are schema-level and belong here. Row-level truth
(is *this* row's approval/lock/transition state currently permitting a
write) is deliberately NOT modeled here — that is a runtime capabilities
endpoint's job, not something a static spec can honestly claim to know.
"""

OPENAPI_VERSION = '3.1.0'

_READONLY_FIELDS = {'id', 'created_at', 'updated_at', 'creator_id'}

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


def _clean_field_schema(defn: dict) -> dict:
    """Strip non-standard keys from one field definition, keep the rest.

    Falls back to `{'type': 'string'}` for a field def that (after
    stripping) carries no recognizable JSON Schema type information at
    all — a bare relation placeholder or similarly minimal declaration —
    rather than emitting an empty, meaningless `{}` schema object.
    """
    cleaned = {k: v for k, v in defn.items() if k in _STANDARD_SCHEMA_KEYS}
    return cleaned or {'type': 'string'}


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

    record_properties = {
        name: _clean_field_schema(defn) for name, defn in all_props.items()
    }
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
    record_ref = {'$ref': f'#/components/schemas/{schema_name}'}
    create_ref = {'$ref': f'#/components/schemas/{create_schema_name}'}
    error_ref = {'$ref': '#/components/schemas/Error'}
    bulk_result_ref = {'$ref': '#/components/schemas/BulkResult'}

    tag = parent
    paths: dict = {}

    if ctx.get('can_list') or ctx.get('can_create'):
        list_item: dict = {}
        if ctx.get('can_list'):
            list_item['get'] = {
                'tags': [tag],
                'summary': f'List {parent}',
                'responses': {
                    '200': {
                        'description': 'OK',
                        'content': {
                            'application/json': {
                                'schema': {'type': 'array', 'items': record_ref},
                            },
                        },
                    },
                },
            }
        if ctx.get('can_create'):
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
                    '400': {
                        'description': 'Bad request',
                        'content': {'application/json': {'schema': error_ref}},
                    },
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
                    '404': {'description': 'Not found', 'content': {'application/json': {'schema': error_ref}}},
                },
            }
        if ctx.get('can_update'):
            detail_item['put'] = {
                'tags': [tag],
                'summary': f'Replace a {parent}',
                'requestBody': {
                    'required': True,
                    'content': {'application/json': {'schema': create_ref}},
                },
                'responses': {
                    '200': {'description': 'OK'},
                    '404': {'description': 'Not found', 'content': {'application/json': {'schema': error_ref}}},
                },
            }
        if ctx.get('can_delete'):
            detail_item['delete'] = {
                'tags': [tag],
                'summary': f'Delete a {parent}',
                'responses': {
                    '204': {'description': 'No content'},
                    '404': {'description': 'Not found', 'content': {'application/json': {'schema': error_ref}}},
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
    if ctx.get('can_create'):
        bulk_item['post'] = {
            'tags': [tag],
            'summary': f'Bulk-create {parent}',
            'requestBody': {
                'required': True,
                'content': {'application/json': {'schema': {'type': 'array', 'items': create_ref}}},
            },
            'responses': bulk_response,
        }
    if ctx.get('can_update'):
        bulk_item['put'] = {
            'tags': [tag],
            'summary': f'Bulk-update {parent}',
            'responses': bulk_response,
        }
    if ctx.get('can_delete'):
        bulk_item['delete'] = {
            'tags': [tag],
            'summary': f'Bulk-delete {parent}',
            'responses': bulk_response,
        }
    if bulk_item:
        paths[f'/api/{parent}/bulk'] = bulk_item

    return {
        'schemas': {schema_name: record_schema, create_schema_name: create_schema},
        'paths': paths,
        'tag': tag,
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
                'generated from json_schema.yaml. Build artifact only — '
                'not served by the deployed app by default; a deployment '
                'that wants to expose it wires up its own route.'
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
