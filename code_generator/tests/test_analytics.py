"""
Tests for analytics Phase 1: x-analytics schema parsing and backward compatibility.

Ensures that when x-analytics is absent or disabled, generated context
contains no analytics activation and no PostHog SDK references appear.
"""
from pathlib import Path

import pytest
from build_context import build_context


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
        """The analytics_provider.tsx.jinja2 template must not import the PostHog SDK."""
        template_path = (
            Path(__file__).parent.parent / "templates" / "analytics_provider.tsx.jinja2"
        )
        assert template_path.exists(), "analytics_provider.tsx.jinja2 template must exist"
        content = template_path.read_text()
        # Check for actual SDK import patterns, not just the word in comments
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
                f"Phase 1 no-op provider must not import or initialize PostHog SDK: found '{pattern}'"
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
