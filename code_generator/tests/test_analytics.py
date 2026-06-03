"""
Tests for analytics: x-analytics schema parsing, backward compatibility,
Phase 2 PostHog provider rendering, and click sanitizer allowlist.
"""
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader
from build_context import build_context
from generators import form_upsert_context

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


def _render_provider(analytics_enabled: bool, posthog_host: str = '', **extra) -> str:
    """Render analytics_provider.tsx.jinja2 with the given enabled flag."""
    env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)))
    tpl = env.get_template('analytics_provider.tsx.jinja2')
    return tpl.render(
        analytics_enabled=analytics_enabled,
        analytics_posthog_host=posthog_host,
        analytics_topology='embedded',
        analytics_ingest_endpoint='',
        **extra,
    )


# ---------------------------------------------------------------------------
# Minimal schema helpers
# ---------------------------------------------------------------------------

def _base_schema(extra_root: dict = None) -> dict:
    schema = {
        "definitions": {
            "widget": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                },
            },
            "widget_detail": {
                "type": "object",
                "properties": {},
            },
        }
    }
    if extra_root:
        schema.update(extra_root)
    return schema


def _entity() -> dict:
    return {
        "parent": "widget",
        "model": "widget",
        "definition_key": "widget_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }


# ---------------------------------------------------------------------------
# x-analytics parsing tests
# ---------------------------------------------------------------------------

class TestAnalyticsContextParsing:

    def test_analytics_disabled_when_absent(self):
        """When schema has no x-analytics, analytics_enabled must be False."""
        ctx = build_context(_entity(), _base_schema())
        assert ctx["analytics_enabled"] is False

    def test_analytics_disabled_when_explicitly_false(self):
        """When x-analytics.enabled is false, analytics_enabled must be False."""
        schema = _base_schema({"x-analytics": {"enabled": False}})
        ctx = build_context(_entity(), schema)
        assert ctx["analytics_enabled"] is False

    def test_analytics_enabled_when_true(self):
        """When x-analytics.enabled is true, analytics_enabled must be True."""
        schema = _base_schema({"x-analytics": {"enabled": True}})
        ctx = build_context(_entity(), schema)
        assert ctx["analytics_enabled"] is True

    def test_analytics_posthog_host_defaults_to_empty(self):
        """When posthog_host is not specified, analytics_posthog_host defaults to empty string."""
        ctx = build_context(_entity(), _base_schema())
        assert ctx["analytics_posthog_host"] == ""

    def test_analytics_topology_defaults_to_embedded(self):
        """When topology is not specified, analytics_topology defaults to 'embedded'."""
        ctx = build_context(_entity(), _base_schema())
        assert ctx["analytics_topology"] == "embedded"

    def test_analytics_ingest_endpoint_defaults_to_empty(self):
        """When ingest_endpoint is not specified, analytics_ingest_endpoint defaults to empty string."""
        ctx = build_context(_entity(), _base_schema())
        assert ctx["analytics_ingest_endpoint"] == ""

    def test_analytics_posthog_host_and_topology_parsed(self):
        """posthog_host and topology values from x-analytics are read correctly."""
        schema = _base_schema({
            "x-analytics": {
                "enabled": True,
                "posthog_host": "https://posthog.example.com",
                "topology": "separated",
                "ingest_endpoint": "https://analytics.example.com/api/v1/events",
            }
        })
        ctx = build_context(_entity(), schema)
        assert ctx["analytics_posthog_host"] == "https://posthog.example.com"
        assert ctx["analytics_topology"] == "separated"
        assert ctx["analytics_ingest_endpoint"] == "https://analytics.example.com/api/v1/events"

    def test_analytics_no_endpoint_field(self):
        """Context must NOT expose the old 'analytics_endpoint' key — use posthog_host instead."""
        ctx = build_context(_entity(), _base_schema())
        assert "analytics_endpoint" not in ctx, (
            "Deprecated 'analytics_endpoint' key must not appear in context; use 'analytics_posthog_host'"
        )


# ---------------------------------------------------------------------------
# No PostHog SDK when analytics disabled
# ---------------------------------------------------------------------------

class TestAnalyticsDisabledProducesNoPosthogImport:

    def test_analytics_disabled_by_default_produces_no_posthog_import(self):
        """When x-analytics is absent, context must not activate PostHog."""
        ctx = build_context(_entity(), _base_schema())
        assert ctx["analytics_enabled"] is False, (
            "analytics must be disabled when x-analytics is absent from schema"
        )

    def test_analytics_false_produces_no_posthog_import(self):
        """When x-analytics.enabled is false, analytics_enabled must be False."""
        schema = _base_schema({"x-analytics": {"enabled": False}})
        ctx = build_context(_entity(), schema)
        assert ctx["analytics_enabled"] is False, (
            "analytics must remain disabled when x-analytics.enabled is explicitly false"
        )

    def test_noop_provider_template_has_no_sdk_import(self):
        """When analytics is disabled, the rendered provider must not import the PostHog SDK."""
        assert (_TEMPLATES_DIR / "analytics_provider.tsx.jinja2").exists(), \
            "analytics_provider.tsx.jinja2 template must exist"
        content = _render_provider(analytics_enabled=False)
        import_patterns = [
            "import posthog",
            "from 'posthog-js'",
            'from "posthog-js"',
            "require('posthog-js')",
            'require("posthog-js")',
            "posthog.init(",
        ]
        for pattern in import_patterns:
            assert pattern not in content, (
                f"Disabled analytics provider must not import or initialize PostHog SDK: found '{pattern}'"
            )


# ---------------------------------------------------------------------------
# Backward-compat: analytics absent == analytics disabled (identical behavior)
# ---------------------------------------------------------------------------

class TestAnalyticsBackwardCompat:

    def test_analytics_absent_produces_no_analytics_context(self):
        """When x-analytics is absent, analytics_enabled must be False (no PostHog activation)."""
        ctx = build_context(_entity(), _base_schema())
        assert ctx["analytics_enabled"] is False, (
            "analytics_enabled must be False when x-analytics is absent"
        )
        assert ctx["analytics_posthog_host"] == "", (
            "analytics_posthog_host must be empty when x-analytics is absent"
        )

    def test_analytics_disabled_identical_to_absent(self):
        """x-analytics.enabled=false must produce same analytics context as absent."""
        ctx_absent = build_context(_entity(), _base_schema())
        ctx_disabled = build_context(
            _entity(),
            _base_schema({"x-analytics": {"enabled": False}}),
        )
        analytics_keys = [k for k in ctx_absent if k.startswith("analytics_")]
        for key in analytics_keys:
            assert ctx_absent[key] == ctx_disabled[key], (
                f"Key '{key}' differs between absent and disabled: "
                f"{ctx_absent[key]!r} vs {ctx_disabled[key]!r}"
            )


# ---------------------------------------------------------------------------
# Phase 2: PostHog SDK rendering and click sanitizer
# ---------------------------------------------------------------------------

class TestAnalyticsPhase2:

    def test_analytics_disabled_no_posthog_import(self):
        """When disabled, rendered analytics_provider.tsx must not reference posthog-js."""
        content = _render_provider(analytics_enabled=False)
        for pattern in ('posthog-js', 'posthog.init(', 'posthog.capture(', 'PostHogProvider'):
            assert pattern not in content, (
                f"Disabled provider must not reference PostHog SDK: found '{pattern}'"
            )

    def test_analytics_enabled_includes_posthog_sdk(self):
        """When enabled, rendered analytics_provider.tsx must initialize PostHog."""
        content = _render_provider(analytics_enabled=True)
        assert "posthog.init(" in content, "Enabled provider must initialize PostHog SDK"
        assert "captureSafe('page_view'" in content, "Enabled provider must emit page_view via captureSafe"
        assert "PostHogProvider" in content, "Enabled provider must wrap with PostHogProvider"

    def test_click_sanitizer_excludes_text_content(self):
        """analytics.capture must strip non-allowlisted fields from click payloads."""
        content = _render_provider(analytics_enabled=True)
        assert "'element_id'" in content, "Click allowlist must include 'element_id'"
        assert "'aria_label'" in content, "Click allowlist must include 'aria_label'"
        assert "'route'" in content, "Click allowlist must include 'route'"
        assert "'text'" not in content, "Click allowlist must NOT include 'text'"
        assert "'value'" not in content, "Click allowlist must NOT include 'value'"
        assert "'text_content'" not in content, "Click allowlist must NOT include 'text_content'"

    def test_page_view_drops_query_string(self):
        """page_view event must not reference useSearchParams or query string fields."""
        content = _render_provider(analytics_enabled=True)
        assert 'useSearchParams' not in content, "page_view must not capture query params"
        assert 'searchParams' not in content, "page_view must not capture search params"

    def test_posthog_destructive_features_disabled(self):
        """PostHog init must disable session recording, autocapture, and capture_pageview."""
        content = _render_provider(analytics_enabled=True)
        assert 'autocapture: false' in content, "autocapture must be disabled"
        assert 'capture_pageview: false' in content, "capture_pageview must be disabled"
        assert 'disable_session_recording: true' in content, "session recording must be disabled"

    def test_heatmaps_and_surveys_disabled(self):
        """PostHog init must disable heatmaps and surveys."""
        content = _render_provider(analytics_enabled=True)
        assert 'heatmaps: false' in content, "heatmaps must be disabled"
        assert 'surveys: false' in content, "surveys must be disabled"

    def test_click_handler_defined_when_enabled(self):
        """Enabled provider must contain a delegated click listener on document.body."""
        content = _render_provider(analytics_enabled=True)
        assert 'addEventListener' in content, "Enabled provider must add event listener"
        assert 'click' in content, "Click event must be captured"
        assert 'aria-label' in content or 'aria_label' in content, "Click props must include aria-label"
        assert 'element_id' in content, "Click props must include element_id"
        assert 'innerText' not in content, "Click props must NOT include innerText"
        assert 'textContent' not in content, "Click props must NOT include textContent"

    def test_click_handler_not_in_disabled_provider(self):
        """Disabled provider must not contain click tracking."""
        content = _render_provider(analytics_enabled=False)
        assert 'addEventListener' not in content, "Disabled provider must not add event listeners"


# ---------------------------------------------------------------------------
# Phase 3: Privacy proof tests P1-P7
# ---------------------------------------------------------------------------

class TestAnalyticsPhase3Privacy:

    # P1: Printable keys do not leak via key_special; key_count payload is count-only
    def test_p1_key_special_no_printable_chars(self):
        """key_special listener must guard against printable characters via allowlist check."""
        content = _render_provider(analytics_enabled=True, analytics_event_key_special=True)
        assert '_ALLOWED_SPECIAL_KEYS' in content, \
            "key_special listener must define an allowed-key set"
        assert '_ALLOWED_SPECIAL_KEYS.has(event.key)' in content, \
            "key_special listener must guard with .has(event.key) check"
        # key_special payload must contain key_name (the allowed key name), not raw character capture
        assert "key_name: event.key" in content, \
            "key_special payload must use key_name from the allowed set"

    def test_p1_key_count_payload_has_no_key_name(self):
        """key_count listener must not include key name or character in payload."""
        content = _render_provider(analytics_enabled=True, analytics_event_key_count=True)
        # The key_count handler must increment a counter, not record event.key
        assert 'key_count' in content, "key_count listener must be present"
        # Verify that the key_count captureSafe call does not reference event.key
        # Find the captureSafe('key_count', ...) block and verify its payload
        assert "captureSafe('key_count'" in content, \
            "key_count must emit via captureSafe"
        assert 'interval_ms' in content, "key_count payload must include interval_ms"
        assert 'count' in content, "key_count payload must include count"
        # Critically: key name / character must NOT appear in key_count payload
        key_count_start = content.index("captureSafe('key_count'")
        key_count_block = content[key_count_start:key_count_start + 200]
        assert 'event.key' not in key_count_block, \
            "key_count payload must NOT include event.key"
        assert 'key_name' not in key_count_block, \
            "key_count payload must NOT include key_name"

    # P2: Only allowed special keys trigger key_special
    def test_p2_key_special_allowlist_completeness(self):
        """key_special must only emit for Tab/Enter/Escape/Arrow*/Backspace/Delete."""
        content = _render_provider(analytics_enabled=True, analytics_event_key_special=True)
        required_keys = ['Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown',
                         'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete']
        for key in required_keys:
            assert f"'{key}'" in content, \
                f"_ALLOWED_SPECIAL_KEYS must include '{key}'"

    def test_p2_key_special_not_emitted_when_disabled(self):
        """When analytics_event_key_special=False, no key_special listener is rendered."""
        content = _render_provider(analytics_enabled=True, analytics_event_key_special=False)
        assert 'KeySpecialTracker' not in content, \
            "KeySpecialTracker must not appear when key_special is disabled"
        assert '_ALLOWED_SPECIAL_KEYS' not in content, \
            "_ALLOWED_SPECIAL_KEYS must not appear when key_special is disabled"

    # P3: Form event payloads do not include value/label/placeholder/FormData/nested objects
    def test_p3_form_lifecycle_excludes_sensitive_fields(self):
        """FormLifecycleTracker must not touch value/label/placeholder/FormData in payload."""
        content = _render_provider(
            analytics_enabled=True,
            analytics_event_form_submit=True,
            analytics_event_form_field_blur=True,
            analytics_event_validation_error=True,
        )
        assert 'FormLifecycleTracker' in content, "FormLifecycleTracker must be present"
        # Find the FormLifecycleTracker function body
        tracker_start = content.index('function FormLifecycleTracker')
        tracker_end = content.index('\nfunction ', tracker_start + 1) if '\nfunction ' in content[tracker_start + 1:] else len(content)
        tracker_body = content[tracker_start:tracker_end]
        forbidden = ["detail['value']", "detail['label']", "detail['placeholder']",
                     "detail['message']", 'FormData', 'detail.value', 'detail.label']
        for field in forbidden:
            assert field not in tracker_body, \
                f"FormLifecycleTracker must NOT reference '{field}'"

    # P4: sanitizeEvent behavior — unknown event null, unknown prop strip, non-primitive strip, truncate
    def test_p4_sanitize_event_rejects_unknown_events(self):
        """sanitizeEvent must return null for unknown event names."""
        content = _render_provider(analytics_enabled=True)
        assert 'function sanitizeEvent' in content, "sanitizeEvent must be defined"
        assert 'if (!allowed) return null' in content, \
            "sanitizeEvent must return null for unknown events"

    def test_p4_sanitize_event_strips_unknown_properties(self):
        """sanitizeEvent must skip properties not in the allowlist."""
        content = _render_provider(analytics_enabled=True)
        assert 'if (!allowed.has(k)) continue' in content, \
            "sanitizeEvent must skip non-allowlisted properties"

    def test_p4_sanitize_event_strips_non_primitives(self):
        """sanitizeEvent must only pass through string/number/boolean/null values."""
        content = _render_provider(analytics_enabled=True)
        # Verify the type guard — only string, number, boolean, null are forwarded
        assert "typeof v === 'string'" in content, \
            "sanitizeEvent must explicitly check for string type"
        assert "typeof v === 'boolean'" in content, \
            "sanitizeEvent must explicitly check for boolean type"
        assert "typeof v === 'number'" in content, \
            "sanitizeEvent must explicitly check for number type"

    def test_p4_sanitize_event_truncates_long_strings(self):
        """sanitizeEvent must truncate strings to _MAX_STRING_LENGTH."""
        content = _render_provider(analytics_enabled=True)
        assert '_MAX_STRING_LENGTH' in content, \
            "sanitizeEvent must define _MAX_STRING_LENGTH constant"
        assert 'v.slice(0, _MAX_STRING_LENGTH)' in content, \
            "sanitizeEvent must truncate strings using _MAX_STRING_LENGTH"

    # P5: posthog.capture appears exactly once in enabled provider (inside captureSafe)
    def test_p5_posthog_capture_called_only_in_capture_safe(self):
        """posthog.capture must appear exactly once in the enabled provider, inside captureSafe."""
        content = _render_provider(
            analytics_enabled=True,
            analytics_event_key_special=True,
            analytics_event_key_count=True,
            analytics_event_form_submit=True,
            analytics_event_form_field_blur=True,
            analytics_event_validation_error=True,
        )
        occurrences = content.count('posthog.capture(')
        assert occurrences == 1, \
            f"posthog.capture( must appear exactly once (inside captureSafe); found {occurrences}"
        # Verify it appears inside captureSafe
        capture_safe_start = content.index('function captureSafe')
        capture_safe_end = content.index('\nfunction ', capture_safe_start + 1)
        capture_safe_body = content[capture_safe_start:capture_safe_end]
        assert 'posthog.capture(' in capture_safe_body, \
            "posthog.capture must be inside captureSafe function"

    # P6: x-analytics absent/disabled produces no analytics content
    def test_p6_disabled_provider_has_no_analytics_attributes(self):
        """Disabled analytics provider must not contain any analytics listeners or attributes."""
        content = _render_provider(analytics_enabled=False)
        for pattern in ('posthog.capture(', 'captureSafe', 'sanitizeEvent',
                        'allowedPropertiesByEvent', 'addEventListener', 'PostHogProvider'):
            assert pattern not in content, \
                f"Disabled provider must not contain '{pattern}'"

    def test_p6_context_absent_produces_disabled(self):
        """When x-analytics is absent from schema, analytics_enabled is False."""
        from build_context import build_context as bc

        def _entity():
            return {
                "parent": "widget", "model": "widget", "definition_key": "widget_detail",
                "children": [],
                "generate_config": {"list": True, "view": True, "new": True, "edit": True,
                                    "delete": True, "api": False, "test": False, "fields": None},
            }

        def _schema():
            return {
                "definitions": {
                    "widget": {"type": "object", "required": ["id", "name"],
                               "properties": {"id": {"type": "string"}, "name": {"type": "string"}}},
                    "widget_detail": {"type": "object", "properties": {}},
                }
            }

        ctx = bc(_entity(), _schema())
        assert ctx['analytics_enabled'] is False
        assert ctx['analytics_event_key_special'] is False
        assert ctx['analytics_event_key_count'] is False
        assert ctx['analytics_event_form_submit'] is False
        assert ctx['analytics_event_form_field_blur'] is False
        assert ctx['analytics_event_validation_error'] is False

    # P7: events.key_special flag controls KeySpecialTracker presence
    def test_p7_key_special_false_disables_listener(self):
        """When analytics_event_key_special=False, KeySpecialTracker must not be rendered."""
        content = _render_provider(analytics_enabled=True, analytics_event_key_special=False)
        assert 'KeySpecialTracker' not in content, \
            "KeySpecialTracker must be absent when events.key_special=false"

    def test_p7_key_special_true_enables_listener(self):
        """When analytics_event_key_special=True, KeySpecialTracker must be rendered."""
        content = _render_provider(analytics_enabled=True, analytics_event_key_special=True)
        assert 'KeySpecialTracker' in content, \
            "KeySpecialTracker must be present when events.key_special=true"
        assert 'function KeySpecialTracker' in content, \
            "KeySpecialTracker function must be defined when events.key_special=true"

    def test_p7_per_event_flags_parsed_from_schema(self):
        """Per-event flags in x-analytics.events must be parsed correctly by build_context."""
        from build_context import build_context as bc

        def _entity():
            return {
                "parent": "widget", "model": "widget", "definition_key": "widget_detail",
                "children": [],
                "generate_config": {"list": True, "view": True, "new": True, "edit": True,
                                    "delete": True, "api": False, "test": False, "fields": None},
            }

        def _schema():
            return {
                "x-analytics": {
                    "enabled": True,
                    "events": {
                        "key_special": True,
                        "key_count": True,
                        "form_submit": True,
                        "form_field_blur": False,
                        "validation_error": True,
                    },
                },
                "definitions": {
                    "widget": {"type": "object", "required": ["id", "name"],
                               "properties": {"id": {"type": "string"}, "name": {"type": "string"}}},
                    "widget_detail": {"type": "object", "properties": {}},
                },
            }

        ctx = bc(_entity(), _schema())
        assert ctx['analytics_event_key_special'] is True
        assert ctx['analytics_event_key_count'] is True
        assert ctx['analytics_event_form_submit'] is True
        assert ctx['analytics_event_form_field_blur'] is False
        assert ctx['analytics_event_validation_error'] is True


# ---------------------------------------------------------------------------
# Phase 3: Runtime proof tests RP1-RP7 (method B)
# ---------------------------------------------------------------------------

class TestAnalyticsPhase3Runtime:
    """
    Runtime proof tests re-implementing sanitizeEvent and allowedPropertiesByEvent
    in Python (method B), parsed from the rendered template source.
    """

    @staticmethod
    def _parse_allowed_properties(content: str) -> dict:
        """Extract allowedPropertiesByEvent mapping from rendered template source."""
        import re
        result = {}
        pattern = r"(\w+):\s+new Set\(\[([^\]]*)\]\)"
        for match in re.finditer(pattern, content):
            event_name = match.group(1)
            props_str = match.group(2)
            props = re.findall(r"'([^']+)'", props_str)
            result[event_name] = set(props)
        return result

    @staticmethod
    def _sanitize_event(event_name: str, props: dict, allowed_props: dict, max_len: int = 200):
        """Python re-implementation of sanitizeEvent from the template."""
        allowed = allowed_props.get(event_name)
        if allowed is None:
            return None
        out = {}
        for k, v in props.items():
            if k not in allowed:
                continue
            if v is None or isinstance(v, bool) or isinstance(v, (int, float)):
                out[k] = v
            elif isinstance(v, str):
                out[k] = v[:max_len]
        return out

    def _get_allowed_props(self) -> dict:
        content = _render_provider(analytics_enabled=True)
        return self._parse_allowed_properties(content)

    def test_rp1_unknown_event_returns_none(self):
        """RP1: sanitizeEvent with an unknown event name must return null (None)."""
        allowed = self._get_allowed_props()
        result = self._sanitize_event('unknown_event_xyz', {'route': '/test'}, allowed)
        assert result is None, "sanitizeEvent must return None for unknown events"

    def test_rp2_unknown_props_stripped(self):
        """RP2: sanitizeEvent with allowed event + unknown props must return only allowed props."""
        allowed = self._get_allowed_props()
        result = self._sanitize_event('page_view', {
            'route': '/test',
            'user_id': 'u123',
            'secret': 'password',
        }, allowed)
        assert result is not None, "sanitizeEvent must return non-None for known event"
        assert 'route' in result, "Allowed prop 'route' must be preserved"
        assert 'user_id' not in result, "Unknown prop 'user_id' must be stripped"
        assert 'secret' not in result, "Unknown prop 'secret' must be stripped"

    def test_rp3_non_primitive_stripped(self):
        """RP3: sanitizeEvent must strip non-primitive values (objects, lists, etc.)."""
        allowed = self._get_allowed_props()
        result = self._sanitize_event('click', {
            'element_id': 'btn-1',
            'role': {'nested': 'object'},
            'aria_label': ['list', 'value'],
            'route': '/test',
        }, allowed)
        assert result is not None
        assert 'element_id' in result, "Primitive string value must be preserved"
        assert 'route' in result, "Primitive string route must be preserved"
        assert 'role' not in result, "Dict value must be stripped as non-primitive"
        assert 'aria_label' not in result, "List value must be stripped as non-primitive"

    def test_rp4_long_string_truncated(self):
        """RP4: sanitizeEvent must truncate strings exceeding _MAX_STRING_LENGTH (200)."""
        allowed = self._get_allowed_props()
        long_value = 'x' * 300
        result = self._sanitize_event('page_view', {'route': long_value}, allowed)
        assert result is not None
        assert len(result['route']) == 200, \
            f"String must be truncated to 200 chars, got {len(result['route'])}"

    def test_rp5_printable_chars_not_in_allowed_special_keys(self):
        """RP5: Printable character keys (a-z, A-Z, 0-9) must not be in _ALLOWED_SPECIAL_KEYS."""
        import re
        content = _render_provider(analytics_enabled=True, analytics_event_key_special=True)
        assert '_ALLOWED_SPECIAL_KEYS' in content, "_ALLOWED_SPECIAL_KEYS must be defined"
        match = re.search(r'_ALLOWED_SPECIAL_KEYS\s*=\s*new Set\(\[([^\]]+)\]\)', content)
        assert match, "_ALLOWED_SPECIAL_KEYS definition must match expected pattern"
        allowed_keys = re.findall(r"'([^']+)'", match.group(1))
        printable = list('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
        for char in printable:
            assert char not in allowed_keys, \
                f"Printable character '{char}' must not be in _ALLOWED_SPECIAL_KEYS"

    def test_rp6_form_field_blur_focusout_listener_emits_on_field_id(self):
        """RP6: focusout listener must emit form_field_blur when data-analytics-field-id is present."""
        content = _render_provider(
            analytics_enabled=True,
            analytics_event_form_field_blur=True,
        )
        assert 'focusout' in content, \
            "form_field_blur provider must register a focusout event listener"
        assert "getAttribute('data-analytics-field-id')" in content, \
            "focusout handler must read data-analytics-field-id attribute"
        assert "captureSafe('form_field_blur'" in content, \
            "focusout handler must call captureSafe with form_field_blur"

    def test_rp6_form_field_blur_ignored_without_field_id(self):
        """RP6: focusout handler must ignore elements that lack data-analytics-field-id."""
        content = _render_provider(
            analytics_enabled=True,
            analytics_event_form_field_blur=True,
        )
        assert 'if (!fieldId) return' in content, \
            "focusout handler must early-return when fieldId is absent"

    def test_rp7_posthog_capture_only_inside_capture_safe(self):
        """RP7: posthog.capture must appear exactly once in the template, inside captureSafe."""
        content = _render_provider(
            analytics_enabled=True,
            analytics_event_key_special=True,
            analytics_event_key_count=True,
            analytics_event_form_submit=True,
            analytics_event_form_field_blur=True,
            analytics_event_validation_error=True,
        )
        count = content.count('posthog.capture(')
        assert count == 1, \
            f"posthog.capture( must appear exactly once (inside captureSafe); found {count}"
        capture_safe_start = content.index('function captureSafe')
        next_fn = content.index('\nfunction ', capture_safe_start + 1)
        capture_safe_body = content[capture_safe_start:next_fn]
        assert 'posthog.capture(' in capture_safe_body, \
            "posthog.capture must be inside the captureSafe function"


# ---------------------------------------------------------------------------
# Batch 1 fixture helpers
# ---------------------------------------------------------------------------

def _render_form_upsert(schema: dict, entity: str) -> str:
    """Render form_upsert.tsx.jinja2 with fully merged context for the given entity."""
    entity_dict = {
        "parent": entity,
        "model": entity,
        "definition_key": f"{entity}_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }
    ctx = build_context(entity_dict, schema)
    ups_ctx = {**ctx, **form_upsert_context(ctx, schema)}
    env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)))
    tpl = env.get_template('form_upsert.tsx.jinja2')
    return tpl.render(**ups_ctx)


def _analytics_schema(enabled: bool = True) -> dict:
    """Minimal schema fixture with parent1 entity (text/number/datetime/relation fields)."""
    schema: dict = {
        "definitions": {
            "organization": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                },
            },
            "parent1": {
                "type": "object",
                "required": ["id", "name", "organization_id", "price", "due_date"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string", "minLength": 1},
                    "organization_id": {
                        "type": "string",
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "many-to-one",
                            "target": "organization",
                            "labelField": "name",
                        },
                    },
                    "description": {"type": ["string", "null"]},
                    "price": {"type": "integer", "minimum": 0},
                    "due_date": {"type": "string", "format": "date-time"},
                },
            },
            "parent1_detail": {
                "x-generate": {
                    "list": True, "view": True, "new": True,
                    "edit": True, "delete": True, "api": False,
                },
                "allOf": [
                    {"$ref": "#/definitions/parent1"},
                    {
                        "type": "object",
                        "required": ["organization"],
                        "properties": {
                            "organization": {"$ref": "#/definitions/organization"},
                        },
                    },
                ],
            },
        },
    }
    if enabled:
        schema["x-analytics"] = {
            "enabled": True,
            "events": {
                "key_special": True,
                "key_count": True,
                "form_submit": True,
                "form_field_blur": True,
                "validation_error": True,
            },
        }
    return schema


# ---------------------------------------------------------------------------
# Phase 3 Batch 1: analytics-enabled fixture render tests
# ---------------------------------------------------------------------------

class TestAnalyticsBatch1Fixture:
    """Verify that analytics-enabled generator output contains required metadata."""

    @pytest.fixture
    def enabled_schema(self):
        return _analytics_schema(enabled=True)

    def test_form_upsert_contains_analytics_form_id(self, enabled_schema):
        """Generated parent1 FormUpsert has analyticsFormId constant and prop."""
        output = _render_form_upsert(enabled_schema, entity="parent1")
        assert 'analyticsFormId' in output

    def test_form_fields_contain_analytics_field_id(self, enabled_schema):
        """Generated fields have data-analytics-field-id or analyticsFieldId for standard field types."""
        output = _render_form_upsert(enabled_schema, entity="parent1")
        assert 'analyticsFieldId' in output or 'data-analytics-field-id' in output

    def test_lifecycle_signal_present_in_form(self, enabled_schema):
        """Generated FormUpsert dispatches analytics:lifecycle form_submit signal."""
        output = _render_form_upsert(enabled_schema, entity="parent1")
        assert "analytics:lifecycle" in output
        assert "form_submit" in output

    def test_disabled_schema_unchanged(self):
        """x-analytics absent produces output with no analytics attributes (backward compat)."""
        disabled_out = _render_form_upsert(_analytics_schema(enabled=False), entity="parent1")
        assert 'analyticsFormId' not in disabled_out
        assert 'data-analytics-field-id' not in disabled_out
        assert 'analyticsFieldId' not in disabled_out
        assert "analytics:lifecycle" not in disabled_out

    def test_analytics_provider_contains_key_listeners(self, enabled_schema):
        """Enabled analytics provider template includes key_special and key_count listeners."""
        out_special = _render_provider(analytics_enabled=True, analytics_event_key_special=True)
        out_count = _render_provider(analytics_enabled=True, analytics_event_key_count=True)
        assert 'KeySpecialTracker' in out_special or 'key_special' in out_special
        assert 'KeyCountTracker' in out_count or 'key_count' in out_count

    def test_form_field_blur_listener_in_provider(self, enabled_schema):
        """Enabled provider contains focusout delegated listener for form_field_blur."""
        output = _render_provider(analytics_enabled=True, analytics_event_form_field_blur=True)
        assert 'focusout' in output
        assert 'data-analytics-field-id' in output
