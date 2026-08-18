#!/usr/bin/env python3
"""
validate_schema_cli.py — Fast, generation-free schema validation entrypoint.

Runs exactly the same checks generate.py runs immediately before writing any
files (validate_schema + the three Prisma cross-checks), directly importing
and calling those same functions — no duplicated validation logic. Neither
docker, `next build`, nor any code generation runs: the intermediate schema
this reads is the same `.generated/json_schema.yaml` artifact `check:generated`
and `cleanup` already build from the two on-disk source files
(`code_generator/json_schema.yaml`, `prisma/schema.prisma`), and no
application/template output is ever written.

Usage:
    python3 code_generator/validate_schema_cli.py <intermediate_schema.yaml> <output_dir>

Exit 0 and a one-line confirmation on success; exit 1 and the full list of
schema problems (stderr) on failure.
"""
import sys
from pathlib import Path

import yaml

from validate import (
    validate_schema, validate_prisma_indexes,
    validate_self_only_creator_id_columns, validate_defaults_cross_schema,
    SchemaValidationError,
)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(
            'Usage: python3 validate_schema_cli.py <intermediate_schema.yaml> <output_dir>',
            file=sys.stderr,
        )
        return 2

    schema_path = Path(argv[1]).resolve()
    output_dir = Path(argv[2]).resolve()

    if not schema_path.is_file():
        print(f'Schema not found: {schema_path}', file=sys.stderr)
        return 2

    with schema_path.open() as f:
        schema = yaml.safe_load(f)

    prisma_schema_path = output_dir / 'prisma' / 'schema.prisma'
    try:
        validate_schema(schema)
        validate_prisma_indexes(prisma_schema_path)
        validate_self_only_creator_id_columns(schema, prisma_schema_path)
        validate_defaults_cross_schema(schema, prisma_schema_path)
    except SchemaValidationError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print('validate:schema: OK (schema, index, self-only, and default-sync checks passed)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
