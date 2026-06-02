"""
Tests for analytics: x-analytics schema parsing, backward compatibility,
Phase 2 PostHog provider rendering, and click sanitizer allowlist.
"""
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader
from build_context import build_context

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


def _render_provider(analytics_enabled: bool, posthog_host: str = '') -> str:
    """Render analytics_provider.tsx.jinja2 with the given enabled flag."""
    env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)))
    tpl = env.get_template('analytics_provider.tsx.jinja2')
    return tpl.render(
        analytics_enabled=analytics_enabled,
        analytics_posthog_host=posthog_host,
        analytics_topology='embedded',
        analytics_ingest_endpoint='',
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
        assert "posthog.capture('page_view'" in content, "Enabled provider must emit page_view"
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
