"""
mobile_e2e.py -- Maestro flows for the generated Expo app's native screens.

One flow is generated per entity that has native screens, from the same
decision that emits those screens: `build_mobile_entity_spec` returns a spec
only when `mobile_ineligible_reason` admits the entity, and
`generate_mobile_target` hands exactly those specs (and the footer-tab tree
`mobile_nav.build_mobile_nav` built for the same app) to `build_flows` below.
An entity without native screens therefore gets no flow, and an entity with
screens always gets one.

The flows target the `testID`s the native templates already emit (Maestro's
`id:` selector); no new identifier convention and no schema key is involved.
Templates: templates/mobile/e2e/.
"""
from __future__ import annotations

from mobile_entities import (
    KIND_BOOLEAN, KIND_DATE, KIND_DATETIME, KIND_DECIMAL, KIND_ENUM, KIND_NUMBER, KIND_TEXT, KIND_TIME,
)

# Where the flows are written, relative to the generated mobile/ directory.
FLOW_DIR = 'e2e/generated/maestro'

# Field kinds a create flow can fill without a picker, a file chooser or child rows.
_SIMPLE_KINDS = (KIND_TEXT, KIND_NUMBER, KIND_DECIMAL, KIND_BOOLEAN, KIND_ENUM, KIND_DATE, KIND_DATETIME, KIND_TIME)
_DATE_KINDS = (KIND_DATE, KIND_DATETIME, KIND_TIME)


def navigation_path(tabs: list[dict], entity: str) -> list[str] | None:
    """The testIDs to tap, in order, from the signed-in shell to `entity`'s list screen.

    A flat tab is one footer tap (`footer-tab-<entity>`); an entity inside nav groups is a footer tap on its
    top-level group followed by one `nav-row-<slug>` tap per sub-group and a final `nav-row-<entity>`.
    None when the entity is in no tab (it has screens but no way to open them from the footer).
    """
    def walk(nodes: list[dict], prefix: list[str], top: bool) -> list[str] | None:
        for node in nodes:
            tap = ('footer-tab-' if top else 'nav-row-') + (node['slug'] if node['kind'] == 'group' else node['entity'])
            if node['kind'] == 'link' and node['entity'] == entity:
                return prefix + [tap]
            if node['kind'] == 'group':
                found = walk(node['children'], prefix + [tap], False)
                if found:
                    return found
        return None

    return walk(tabs, [], True)


def create_steps(spec: dict) -> list[dict] | None:
    """Form steps that fill the required fields of a creatable entity, or None when no create flow is possible.

    None for an entity that cannot be created, and for one whose required fields need a relation picker,
    an attachment or child rows: those belong to a later growth step, not to the minimal flow. An optional
    field is left blank. A read-only required field cannot be typed, so it also yields None.
    """
    if not (spec['can_new'] and spec['can_view']):
        return None
    steps: list[dict] = []
    for field in spec['fields']:
        if not field['required']:
            continue
        if field['kind'] not in _SIMPLE_KINDS or field['readonly'] or field.get('custom'):
            return None
        key = field['key']
        if field['kind'] == KIND_ENUM:
            if not field['options']:
                return None
            steps.append({'action': 'tap', 'id': f'field-{key}-{field["options"][0]}'})
        elif field['kind'] in _DATE_KINDS:
            steps.append({'action': 'tap', 'id': f'field-{key}-now'})
        elif field['kind'] == KIND_BOOLEAN:
            continue
        elif field['kind'] == KIND_NUMBER:
            steps.append({'action': 'type', 'id': f'field-{key}', 'text': '1'})
        elif field['kind'] == KIND_DECIMAL:
            steps.append({'action': 'type', 'id': f'field-{key}', 'text': '1.5'})
        else:
            steps.append({'action': 'type', 'id': f'field-{key}', 'text': f'e2e ${{E2E_RUN_ID}} {key}'})
    return steps


def build_flows(mobile_specs: list[dict], tabs: list[dict]) -> dict[str, dict]:
    """{entity name: template context} of every entity that gets a flow, in spec order."""
    flows: dict[str, dict] = {}
    for spec in mobile_specs:
        path = navigation_path(tabs, spec['name'])
        if path is None:
            continue
        flows[spec['name']] = {
            'name': spec['name'],
            'title': spec['title'],
            'path': path,
            'can_view': spec['can_view'],
            'create_steps': create_steps(spec),
        }
    return flows
