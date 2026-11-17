"""Security test matrix: manifest generation and the coverage check.

The matrix itself (axes, values, which flags make a value apply, which values
combine) is data in `security_matrix.yaml`; nothing here names an axis or a
value. Adding an axis, a value or a combination rule edits the YAML only.

  * `build_manifest()` expands the matrix for each entity into its applicable
    cells; generate.py writes the result as `.security-manifest.json`.
  * `check()` compares that manifest with the `security-cell:` markers found in
    test files and with the allowlist, and returns the problems.

CLI: python3 security_matrix.py check --manifest M --tests DIR [DIR...] [--allowlist F [F...]]
"""
from __future__ import annotations

import argparse
import itertools
import json
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
MATRIX_PATH = HERE / 'security_matrix.yaml'
ALLOWLIST_PATH = HERE / 'security_matrix_allowlist.yaml'
MANIFEST_FILENAME = '.security-manifest.json'
MARKER = re.compile(r'security-cell:\s*(?P<body>[^\n*]*)')
TEST_SUFFIXES = ('.cy.ts', '.test.ts', '.test.tsx', '.spec.ts', '.cy.ts.jinja2')
WILDCARD = '*'
DENIAL_STATUSES = (401, 403, 404)
# A test file that calls the helper must claim at least one cell, so the call is visible to the check.
HELPER_CALL = re.compile(r'\bexpectDeniedFor\s*\(')


def load_matrix(path: Path = MATRIX_PATH) -> dict:
    matrix = yaml.safe_load(path.read_text(encoding='utf-8'))
    axes = matrix.get('axes')
    if not isinstance(axes, dict) or not axes:
        raise ValueError(f'{path}: "axes" must be a non-empty mapping')
    for axis, spec in axes.items():
        values = spec.get('values')
        if not isinstance(values, dict) or not values:
            raise ValueError(f'{path}: axis {axis!r} has no values')
        if 'default' in spec and spec['default'] not in values:
            raise ValueError(f'{path}: axis {axis!r} default {spec["default"]!r} is not one of its values')
        for value, vspec in values.items():
            for other, allowed in ((vspec or {}).get('combine') or {}).items():
                if other not in axes:
                    raise ValueError(f'{path}: {axis}.{value} combines with unknown axis {other!r}')
                unknown = set(allowed) - set(axes[other]['values'])
                if unknown:
                    raise ValueError(f'{path}: {axis}.{value} combines with unknown {other} values {sorted(unknown)}')
    for axis, spec in axes.items():
        for value, vspec in spec['values'].items():
            status = (vspec or {}).get('denied_status')
            if status is not None and status not in DENIAL_STATUSES:
                raise ValueError(f'{path}: {axis}.{value} denied_status {status!r} must be one of {DENIAL_STATUSES}')
    return matrix


def _flag(flags: dict, name: str) -> bool:
    if name not in flags:
        # Fail closed: a flag the generator does not provide must not silently read as false
        # (that would drop cells and hide coverage gaps).
        raise KeyError(f'security matrix requires unknown flag {name!r}')
    return bool(flags[name])


def applicable_cells(matrix: dict, flags: dict) -> list[dict]:
    """Every cell of the matrix that applies to an entity with these flags."""
    axes = matrix['axes']
    names = list(axes)
    per_axis = []
    for axis in names:
        applying = [
            value for value, spec in axes[axis]['values'].items()
            if all(_flag(flags, f) for f in (spec or {}).get('requires', []))
        ]
        per_axis.append(applying)
    cells = []
    for combo in itertools.product(*per_axis):
        chosen = dict(zip(names, combo))
        ok = True
        for axis, value in chosen.items():
            for other, allowed in ((axes[axis]['values'][value] or {}).get('combine') or {}).items():
                if chosen[other] not in allowed:
                    ok = False
        if ok:
            cell = dict(chosen)
            # Informational: the entry point (route / Server Action) any chosen value declares.
            cell['entry_point'] = next(
                (e for a, v in chosen.items() if (e := (axes[a]['values'][v] or {}).get('entry_point'))), '')
            cells.append(cell)
    return cells


def cell_id(entity: str, cell: dict, axes) -> str:
    # Sorted so the id does not depend on the order axes are declared in.
    return entity + ' ' + ' '.join(f'{a}={cell[a]}' for a in sorted(axes))


def build_manifest(matrix: dict, entity_flags: dict[str, dict]) -> dict:
    axes = list(matrix['axes'])
    denied_status = {
        axis: {v: spec['denied_status'] for v, spec in (matrix['axes'][axis]['values'] or {}).items()
               if spec and 'denied_status' in spec}
        for axis in axes
    }
    return {
        'version': matrix.get('version', 1),
        'axes': axes,
        # Read by the test helpers (test/helpers/security_core.ts); see security_matrix.yaml.
        'denied_status': {a: v for a, v in denied_status.items() if v},
        # Value of an axis a marker may leave out; read by the helpers when matching a claimed cell.
        'axis_defaults': {a: spec['default'] for a, spec in matrix['axes'].items() if 'default' in spec},
        'entities': {
            entity: {'cells': applicable_cells(matrix, flags)}
            for entity, flags in sorted(entity_flags.items())
        },
    }


def parse_marker(body: str, matrix: dict) -> tuple[str, dict] | str:
    """Return (entity, {axis: value}) or an error string."""
    fields = dict(p.split('=', 1) for p in body.split() if '=' in p)
    entity = fields.pop('entity', None)
    if not entity:
        return f'marker without entity=: {body.strip()!r}'
    axes = matrix['axes']
    cell = {}
    for axis, spec in axes.items():
        if axis in fields:
            cell[axis] = fields.pop(axis)
        elif 'default' in spec:
            cell[axis] = spec['default']
        else:
            return f'marker for {entity} does not name axis {axis!r}: {body.strip()!r}'
    if fields:
        return f'marker for {entity} names unknown axes {sorted(fields)}'
    return entity, cell


def scan_markers(roots: list[Path], matrix: dict) -> tuple[dict[str, list[str]], list[str]]:
    """Map cell id -> files claiming it, plus malformed-marker errors."""
    axes = list(matrix['axes'])
    found: dict[str, list[str]] = {}
    errors: list[str] = []
    for root in roots:
        files = [root] if root.is_file() else sorted(p for p in root.rglob('*') if p.is_file())
        for path in files:
            if not path.name.endswith(TEST_SUFFIXES) or 'node_modules' in path.parts:
                continue
            text = path.read_text(encoding='utf-8', errors='replace')
            if HELPER_CALL.search(text) and not MARKER.search(text) and not path.name.endswith('.jinja2'):
                errors.append(f'{path}: calls expectDeniedFor but carries no security-cell marker')
            for m in MARKER.finditer(text):
                parsed = parse_marker(m.group('body'), matrix)
                if isinstance(parsed, str):
                    errors.append(f'{path}: {parsed}')
                    continue
                entity, cell = parsed
                found.setdefault(cell_id(entity, cell, axes), []).append(str(path))
    return found, errors


def load_allowlist(path: Path, matrix: dict) -> list[dict]:
    if not path.exists():
        return []
    entries = (yaml.safe_load(path.read_text(encoding='utf-8')) or {}).get('exempt') or []
    axes = matrix['axes']
    for i, entry in enumerate(entries):
        if not str(entry.get('reason', '')).strip():
            raise ValueError(f'{path}: entry {i} has no reason')
        unknown = set(entry) - {'entity', 'reason', *axes}
        if unknown:
            raise ValueError(f'{path}: entry {i} has unknown keys {sorted(unknown)}')
    return entries


def _matches(entry: dict, entity: str, cell: dict) -> bool:
    if entry.get('entity', WILDCARD) not in (WILDCARD, entity):
        return False
    return all(entry.get(a, WILDCARD) in (WILDCARD, v) for a, v in cell.items())


def check(manifest: dict, markers: dict[str, list[str]], allowlist: list[dict], matrix: dict) -> dict:
    axes = manifest['axes']
    all_cells = {}
    for entity, data in manifest['entities'].items():
        for cell in data['cells']:
            all_cells[cell_id(entity, cell, axes)] = (entity, cell)
    missing, exempted = [], 0
    stale, redundant = [], []
    for cid, (entity, cell) in all_cells.items():
        if cid not in markers and not any(_matches(e, entity, cell) for e in allowlist):
            missing.append(cid)
        elif cid not in markers:
            exempted += 1
    for entry in allowlist:
        hit = [cid for cid, (ent, cell) in all_cells.items() if _matches(entry, ent, cell)]
        if not hit:
            stale.append(entry)  # matches no cell of the manifest
        elif all(cid in markers for cid in hit):
            redundant.append(entry)  # every cell it covers has a test now
    return {
        'missing': missing,
        # A marker naming a cell the manifest does not have: the test points at nothing.
        'unknown_markers': sorted(set(markers) - set(all_cells)),
        'stale_allowlist': stale,
        'redundant_allowlist': redundant,
        'total': len(all_cells),
        'covered': len([c for c in all_cells if c in markers]),
        'exempted': exempted,
    }


def run_check(manifest_path: Path, test_roots: list[Path], allowlist_path: Path | list[Path],
              matrix_path: Path = MATRIX_PATH) -> int:
    matrix = load_matrix(matrix_path)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    markers, errors = scan_markers(test_roots, matrix)
    paths = [allowlist_path] if isinstance(allowlist_path, Path) else allowlist_path
    allowlist = [e for p in paths for e in load_allowlist(p, matrix)]
    result = check(manifest, markers, allowlist, matrix)
    problems = list(errors)
    problems += [f'cell has no test and no allowlist entry: {c}' for c in result['missing']]
    problems += [f'marker names a cell that does not exist: {c}' for c in result['unknown_markers']]
    problems += [f'allowlist entry matches no cell: {e}' for e in result['stale_allowlist']]
    problems += [f'allowlist entry is redundant (all its cells have tests): {e}' for e in result['redundant_allowlist']]
    print(f'security matrix: {result["total"]} cells, {result["covered"]} tested, '
          f'{result["exempted"]} exempted, {len(result["missing"])} missing')
    for p in problems:
        print(f'  {p}', file=sys.stderr)
    return 1 if problems else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('check')
    c.add_argument('--manifest', required=True, type=Path)
    c.add_argument('--tests', required=True, nargs='+', type=Path)
    c.add_argument('--allowlist', nargs='+', type=Path, default=[ALLOWLIST_PATH])
    c.add_argument('--matrix', type=Path, default=MATRIX_PATH)
    args = ap.parse_args(argv)
    return run_check(args.manifest, args.tests, args.allowlist, args.matrix)


if __name__ == '__main__':
    sys.exit(main())
