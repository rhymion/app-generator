"""
Every service in the "Destinations of the running application" table of outbound-communications.md must have a
row in external-service-security-contracts.md (Issue #1241), so an integration cannot be added without stating
who can read its data, its credential, and whether it fails open or closed.

Run:
    python3 -m pytest code_generator/tests/test_external_service_contracts.py -v
"""
import re
from pathlib import Path

KNOWLEDGE = Path(__file__).resolve().parents[2] / 'docs' / 'knowledge'
OUTBOUND = KNOWLEDGE / 'outbound-communications.md'
CONTRACTS = KNOWLEDGE / 'external-service-security-contracts.md'

# Outbound table service -> text that must start a row's first cell in the contracts page.
# A new outbound row with no entry here fails test_every_outbound_service_is_mapped.
CONTRACT_ROW = {
    'PostgreSQL': 'Database and connection pooler',
    'Redis (rate limiting)': 'Redis / Upstash',
    'Google Cloud Storage (attachments)': 'Google Cloud Storage (attachments',
    'Vercel Blob (attachments)': 'Vercel Blob (attachments)',
    'Local disk (attachments)': 'Local disk (attachments',
    'Google Cloud Storage (audit-log copies)': 'Workload identity federation',
    'Google token exchange': 'Workload identity federation',
    'Amazon S3 (audit-log copies)': 'Amazon S3 (audit-log copies',
    'Google sign-in': 'Google OAuth',
    'Stripe': 'Stripe',
}


def _outbound_services():
    text = OUTBOUND.read_text(encoding='utf-8')
    section = text.split('## Destinations of the running application', 1)[1].split('\n## ', 1)[0]
    services = []
    for line in section.splitlines():
        m = re.match(r'\| ([^|]+) \|', line)
        if m and m.group(1).strip() not in ('Service',) and not set(m.group(1).strip()) <= {'-'}:
            services.append(m.group(1).strip())
    return services


def _contract_first_cells():
    cells = []
    for line in CONTRACTS.read_text(encoding='utf-8').splitlines():
        m = re.match(r'\| ([^|]+) \|', line)
        if m and not set(m.group(1).strip()) <= {'-'}:
            cells.append(m.group(1).strip())
    return cells


def test_outbound_table_is_found():
    assert len(_outbound_services()) >= 10


def test_every_outbound_service_is_mapped():
    unmapped = [s for s in _outbound_services() if s not in CONTRACT_ROW]
    assert not unmapped, f'add a row to external-service-security-contracts.md and a CONTRACT_ROW entry for: {unmapped}'


def test_every_mapped_service_has_a_contract_row():
    cells = _contract_first_cells()
    missing = [s for s in _outbound_services() if not any(c.startswith(CONTRACT_ROW[s]) for c in cells)]
    assert not missing, f'no contract row for: {missing}'


def test_every_contract_row_has_all_six_columns():
    for line in CONTRACTS.read_text(encoding='utf-8').splitlines():
        if line.startswith('| ') and not line.startswith('| Service') and not line.startswith('|---'):
            assert len(re.split(r'(?<!\\)\s\|\s', line.strip().strip('|').strip())) == 6, line[:80]
