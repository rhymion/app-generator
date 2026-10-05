#!/usr/bin/env python3
"""Compose the child-datagrid-e2e-gate fixture into a disposable app copy.

Used only by scripts/check_child_datagrid_e2e_gate_fixture.sh. Operates on the
copy it is pointed at and never on the repository's own schema files:

  * code_generator/json_schema.yaml  <- the copy's default schema + the fixture's
    entities (fixture json_schema.yaml). A name that already exists in the
    default schema is an error: the fixture must not shadow a real entity.
  * prisma/schema.prisma             <- the copy's default schema + the fixture's
    models (schema_additions.prisma) + the relation back-fields the default
    `user` / `organization` models need (schema_relations.json).
  * lib/<entity>/service_validation_custom.ts <- custom_validation/<entity>.ts, placed
    before generate-code so the write-once stub is not written over it, and
  * cypress/support/<entity>/helper_custom.ts <- custom_helper/<entity>.ts, placed
    before generate-code so the write-once test-helper hook stub is not written over it, and
  * messages/{en,ja}.json            <- messages_validation.json (a consumer
    namespace, as prj_sync would merge it).

Usage: compose_child_datagrid_e2e_fixture.py <fixture_dir> <app_copy_dir>
"""
import json
import re
import sys
from pathlib import Path

from ruamel.yaml import YAML


def compose_json_schema(fixture_dir: Path, app_dir: Path) -> None:
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.width = 4096
    target = app_dir / "code_generator" / "json_schema.yaml"
    with target.open(encoding="utf-8") as f:
        default = yaml.load(f)
    with (fixture_dir / "json_schema.yaml").open(encoding="utf-8") as f:
        fixture = yaml.load(f)

    definitions = default["definitions"]
    clash = sorted(set(fixture["definitions"]) & set(definitions))
    if clash:
        sys.exit(f"fixture entities shadow default entities: {clash}")
    for name, body in fixture["definitions"].items():
        definitions[name] = body
    with target.open("w", encoding="utf-8") as f:
        yaml.dump(default, f)


def compose_prisma(fixture_dir: Path, app_dir: Path) -> None:
    target = app_dir / "prisma" / "schema.prisma"
    text = target.read_text(encoding="utf-8")
    relations = json.loads((fixture_dir / "schema_relations.json").read_text(encoding="utf-8"))

    for model, lines in relations.items():
        match = re.search(rf"^model {re.escape(model)} \{{\n.*?^\}}\n", text, re.S | re.M)
        if not match:
            sys.exit(f"default schema.prisma has no model {model}")
        block = match.group(0)
        injected = block[: -2] + "".join(f"  {line}\n" for line in lines) + "}\n"
        text = text.replace(block, injected, 1)

    additions = (fixture_dir / "schema_additions.prisma").read_text(encoding="utf-8")
    for name in re.findall(r"^(?:model|enum) (\w+) ", additions, re.M):
        if re.search(rf"^(?:model|enum) {name} ", text, re.M):
            sys.exit(f"fixture declares {name}, which the default schema.prisma already has")
    target.write_text(text.rstrip("\n") + "\n\n" + additions, encoding="utf-8")


def compose_custom_validation(fixture_dir: Path, app_dir: Path) -> None:
    # Optional: a fixture without these files (the list-child fixture shares this script) is untouched.
    source_dir = fixture_dir / "custom_validation"
    for source in sorted(source_dir.glob("*.ts")):
        target = app_dir / "lib" / source.stem / "service_validation_custom.ts"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")

    messages_file = fixture_dir / "messages_validation.json"
    if not messages_file.exists():
        return
    additions = json.loads(messages_file.read_text(encoding="utf-8"))
    for locale, namespaces in additions.items():
        path = app_dir / "messages" / f"{locale}.json"
        messages = json.loads(path.read_text(encoding="utf-8"))
        for namespace, entries in namespaces.items():
            messages.setdefault(namespace, {}).update(entries)
        path.write_text(json.dumps(messages, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def compose_custom_helper(fixture_dir: Path, app_dir: Path) -> None:
    # Optional, like compose_custom_validation.
    for source in sorted((fixture_dir / "custom_helper").glob("*.ts")):
        target = app_dir / "cypress" / "support" / source.stem / "helper_custom.ts"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    fixture_dir, app_dir = Path(argv[1]).resolve(), Path(argv[2]).resolve()
    compose_json_schema(fixture_dir, app_dir)
    compose_prisma(fixture_dir, app_dir)
    compose_custom_validation(fixture_dir, app_dir)
    compose_custom_helper(fixture_dir, app_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
