"""Analytics policy constants for Phase 2.

These values are confirmed by Shogun (2026-06-02) and are gathered here
so they can be moved to x-analytics config in a future phase.
"""

# Who sees the consent opt-in prompt
CONSENT_SCOPE = "all_users"

# Identity attachment: both login user and tenant
IDENTITY_ATTACH_USER = True
IDENTITY_ATTACH_TENANT = True

# Route processing
QUERY_STRING_POLICY = "always_drop"  # Never include query strings in payloads

# PostHog SDK feature flags (all disabled to prevent PII leakage)
POSTHOG_DISABLE_SESSION_RECORDING = True
POSTHOG_DISABLE_HEATMAPS = True
POSTHOG_DISABLE_SURVEYS = True
POSTHOG_DISABLE_FEATURE_FLAGS = True
POSTHOG_DISABLE_AUTOCAPTURE = True  # We use manual delegated click capture
