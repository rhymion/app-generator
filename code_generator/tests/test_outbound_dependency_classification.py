"""
Every runtime dependency of a generated app is classified as an outbound integration or not (Issue #1399).

test_external_service_contracts.py checks that each row of the outbound table in
docs/knowledge/outbound-communications.md has a security contract. The outbound table itself is kept by hand, so
a new SDK could ship without a row and therefore without a contract. This test closes that gap:

- every package in `dependencies` of the root package.json (the web app) and of the generated mobile app's
  package.json template is listed exactly once, either in OUTBOUND (mapped to a row of the outbound table, and
  through the existing test to a contract row) or in NOT_OUTBOUND (with a reason);
- no entry names a package that is no longer a dependency;
- a hard-coded `http(s)://host` literal in shipped source (lib/, app/, components/, auth.ts, proxy.ts, templates)
  is either a destination in HOST_DESTINATION (mapped to an outbound row) or in HOST_NOT_A_DESTINATION (with a
  reason), so an outbound call that does not go through a dependency (a plain `fetch` to a fixed host) is caught.

Adding a dependency or a fixed host: put it in the right map below; if it is an outbound integration, add a row
to the outbound table and to external-service-security-contracts.md first.

Run:
    python3 -m pytest code_generator/tests/test_outbound_dependency_classification.py -v
"""
import json
import re
import subprocess
from pathlib import Path

from test_external_service_contracts import _outbound_services

REPO = Path(__file__).resolve().parents[2]
MOBILE_PACKAGE_TEMPLATE = REPO / 'code_generator' / 'templates' / 'mobile' / 'package.json.jinja2'

# Dependency -> the service name in the first column of the outbound table.
OUTBOUND = {
    '@aws-sdk/client-s3': 'Amazon S3 (audit-log copies)',
    '@google-cloud/storage': 'Google Cloud Storage (attachments)',
    '@vercel/blob': 'Vercel Blob (attachments)',
    'google-auth-library': 'Google token exchange',
    'ioredis': 'Redis (rate limiting)',
    'next-auth': 'Google sign-in',
    'nodemailer': 'SMTP server (mail)',
    'stripe': 'Stripe',
    '@prisma/client': 'PostgreSQL',
    '@prisma/adapter-neon': 'PostgreSQL',
    '@vercel/postgres': 'PostgreSQL',
}

# Dependency -> why it is not an outbound integration of its own.
NOT_OUTBOUND = {
    # --- web app ---
    '@auth/prisma-adapter': 'stores Auth.js data through the Prisma client (PostgreSQL row)',
    '@base-ui/react': 'UI components rendered in the browser',
    '@emotion/react': 'CSS-in-JS styling',
    '@emotion/styled': 'CSS-in-JS styling',
    '@mdx-js/loader': 'build-time MDX compilation',
    '@mdx-js/react': 'renders MDX content',
    '@mui/icons-material': 'UI icons',
    '@mui/material': 'UI components',
    '@mui/material-nextjs': 'MUI integration with the Next.js renderer',
    '@mui/x-charts': 'UI charts',
    '@mui/x-data-grid': 'UI data grid',
    '@mui/x-date-pickers': 'UI date pickers',
    '@next/mdx': 'build-time MDX support',
    '@paralleldrive/cuid2': 'local id generation',
    '@prisma/adapter-better-sqlite3': 'local SQLite file, no network',
    '@prisma/extension-accelerate': 'only reaches Prisma Accelerate through a prisma:// DATABASE_URL, which is the PostgreSQL row',
    '@react-pdf/renderer': 'renders PDF files in process',
    '@tailwindcss/typography': 'build-time CSS',
    '@tailwindcss/vite': 'build-time CSS',
    '@types/mdx': 'type definitions only',
    '@types/papaparse': 'type definitions only',
    '@vercel/oidc': 'reads the Vercel OIDC token from the request environment; the exchange itself is the Google token exchange row (google-auth-library)',
    'bcryptjs': 'local password hashing',
    'cron-parser': 'local cron expression parsing',
    'jose': 'local JWT signing and verification',
    'js-yaml': 'local YAML parsing',
    'next': 'the web framework; serves requests, makes no calls of its own beyond those of the app code',
    'next-intl': 'local message catalogs',
    'otplib': 'local TOTP computation',
    'papaparse': 'local CSV parsing',
    'qrcode': 'local QR code rendering',
    'react': 'UI library',
    'react-dom': 'UI library',
    'react-markdown': 'renders Markdown in process',
    'remark-gfm': 'Markdown syntax plugin',
    'swagger-ui-dist': 'static Swagger UI assets served by the app itself',
    # --- generated mobile app (templates/mobile/package.json.jinja2); it calls only the app's own API ---
    '@expo/metro-runtime': 'mobile: bundler runtime',
    '@expo/vector-icons': 'mobile: bundled icon fonts',
    'expo': 'mobile: app runtime; no Expo service is configured (no expo-updates, no push notifications)',
    'expo-constants': 'mobile: reads build-time constants',
    'expo-document-picker': 'mobile: on-device file picker',
    'expo-font': 'mobile: loads bundled fonts',
    'expo-linking': 'mobile: deep links into the app',
    'expo-local-authentication': 'mobile: on-device biometrics',
    'expo-router': 'mobile: navigation',
    'expo-secure-store': 'mobile: on-device keychain storage',
    'expo-status-bar': 'mobile: status bar styling',
    'expo-web-browser': "mobile: opens the Stripe checkout page the app's own API returned (the Stripe row)",
    'react-native': 'mobile: UI runtime',
    'react-native-safe-area-context': 'mobile: layout',
    'react-native-screens': 'mobile: navigation screens',
    'react-native-web': 'mobile: web rendering of the mobile UI',
}

# Hard-coded host -> the service name in the outbound table.
HOST_DESTINATION = {
    'api.pwnedpasswords.com': 'Have I Been Pwned (password breach check)',
    'sts.googleapis.com': 'Google token exchange',
    'iamcredentials.googleapis.com': 'Google token exchange',
    'iam.googleapis.com': 'Google token exchange',
}

# Hard-coded host that is never contacted -> why.
HOST_NOT_A_DESTINATION = {
    'www.w3.org': 'XML namespace URI in inline SVG; never fetched',
    'localhost': 'the app itself (fallback base URL, test helpers)',
    'safe-redirect.invalid': 'parse base for redirect validation (reserved .invalid TLD); never fetched',
    'checkout.stripe.test': 'URL returned by the fake Stripe client used in tests (reserved .test TLD)',
    'app.example.com': 'example in a doc comment',
    'evil.com': 'example in a doc comment',
    'x': 'dummy parse base for resolving a relative link (components/MdxLink.tsx); never fetched',
}

SOURCE_GLOBS = ('lib', 'app', 'components', 'auth.ts', 'proxy.ts', 'instrumentation.ts', 'code_generator/templates')
HOST_RE = re.compile(r"""['"`]https?://([A-Za-z0-9.-]+)""")


def _web_dependencies() -> set[str]:
    return set(json.loads((REPO / 'package.json').read_text(encoding='utf-8')).get('dependencies', {}))


def _mobile_dependencies() -> set[str]:
    text = MOBILE_PACKAGE_TEMPLATE.read_text(encoding='utf-8')
    # The block ends at the first line that closes an object; Jinja `{% if %}` lines inside it also contain '}'.
    block = re.split(r'^\s*},?\s*$', text.split('"dependencies"', 1)[1], maxsplit=1, flags=re.M)[0]
    return set(re.findall(r'^\s*"([^"]+)"\s*:', block, re.M))


def _all_dependencies() -> set[str]:
    return _web_dependencies() | _mobile_dependencies()


def _shipped_source_files() -> list[Path]:
    out = subprocess.run(['git', 'ls-files', '--', *SOURCE_GLOBS], cwd=REPO, capture_output=True, text=True, check=True)
    files = []
    for rel in out.stdout.splitlines():
        if re.search(r'\.test\.|/__tests__/|/generated/|^code_generator/templates/.*test_', rel):
            continue
        if not re.search(r'\.(ts|tsx|js|mjs|jinja2)$', rel):
            continue
        files.append(REPO / rel)
    return files


def test_dependencies_are_found():
    assert 'next' in _web_dependencies()
    assert 'expo' in _mobile_dependencies()


def test_every_dependency_is_classified():
    unclassified = sorted(d for d in _all_dependencies() if d not in OUTBOUND and d not in NOT_OUTBOUND)
    assert not unclassified, (
        'classify these runtime dependencies in OUTBOUND (and add an outbound table row and a contract row) '
        f'or in NOT_OUTBOUND with a reason: {unclassified}'
    )


def test_no_dependency_is_classified_twice():
    assert not set(OUTBOUND) & set(NOT_OUTBOUND)


def test_no_stale_classification():
    stale = sorted((set(OUTBOUND) | set(NOT_OUTBOUND)) - _all_dependencies())
    assert not stale, f'no longer a dependency; remove from the classification: {stale}'


def test_every_reason_is_given():
    assert all(r.strip() for r in NOT_OUTBOUND.values())
    assert all(r.strip() for r in HOST_NOT_A_DESTINATION.values())


def test_outbound_dependencies_map_to_an_outbound_row():
    services = set(_outbound_services())
    missing = {d: s for d, s in {**OUTBOUND, **HOST_DESTINATION}.items() if s not in services}
    assert not missing, f'not a row of the outbound table in outbound-communications.md: {missing}'


def test_every_hard_coded_host_is_classified():
    found: dict[str, str] = {}
    for path in _shipped_source_files():
        for m in HOST_RE.finditer(path.read_text(encoding='utf-8', errors='replace')):
            found.setdefault(m.group(1).lower(), str(path.relative_to(REPO)))
    unclassified = {h: f for h, f in sorted(found.items()) if h not in HOST_DESTINATION and h not in HOST_NOT_A_DESTINATION}
    assert not unclassified, (
        'classify these hard-coded hosts in HOST_DESTINATION (an outbound table row) or HOST_NOT_A_DESTINATION '
        f'with a reason: {unclassified}'
    )
