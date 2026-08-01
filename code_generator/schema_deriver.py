"""Prisma-driven raw-entity derivation for the cmd_395 Stage 3 schema builder.

Design doc: planning/cmd395-schema-restructuring-design.md Sec.3 (Category
A/B/C/D derivability analysis), Sec.5 (R2 intermediate schema), Sec.7 (R4
annotation classification table).

This module has two responsibilities:

1. `parse_prisma_schema()` -- a small, purpose-built (not general-purpose)
   Prisma DSL reader. It only extracts what Sec.3 Category A/B need: scalar
   field type/nullable/default, the `@id` marker, `@updatedAt`, and which
   scalar FK column feeds which `@relation(...)` object field (so a column
   like `role_id` can be resolved to its target model `role`).

2. `derive_raw_entity()` -- given a Prisma model and the *exposed field
   name set* the user schema declares (via `fields:`), reconstructs the
   legacy-shape raw entity dict (`type`, `required`, `properties`) that
   `generate.py` expects, byte/structure-compatible with the pre-Stage-3
   `code_generator/json_schema.yaml`.

Field *exposure* itself is NOT derived from Prisma -- Sec.3's Category A
table describes what's derivable once a field is already chosen for
exposure, not which Prisma columns become JSON schema properties. (Proof:
`user`'s Prisma model has `tenant_id`, `emailVerified`, `mfa_secret`,
`created_at`, etc., none of which ever appeared as `user` JSON schema
properties even pre-Stage-3.) So the user schema's `fields:` map is the
source of truth for the exposed set; this module only fills in what's
mechanically derivable for each already-chosen field.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field as _dc_field
from pathlib import Path

# Category A scalar type mapping (design doc Sec.3 Category A table).
_SCALAR_JSON_TYPE = {
    "String": "string",
    "Boolean": "boolean",
    "Int": "integer",
    "DateTime": "string",
}

_CUID_PATTERN = "^c[a-z0-9]{24,}$"

_ATTR_RE = re.compile(r'@(\w+)(?:\(((?:[^()]|\([^()]*\))*)\))?')
_FIELD_HEAD_RE = re.compile(
    r'^(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s+(?P<type>[A-Za-z_][A-Za-z0-9_]*)(?P<list>\[\])?(?P<opt>\?)?'
)
_RELATION_FIELDS_RE = re.compile(r'fields\s*:\s*\[([^\]]*)\]')
_BLOCK_UNIQUE_RE = re.compile(r'@@unique\(\s*\[([^\]]*)\]')


class SchemaDivergenceError(Exception):
    """Raised when a user-schema annotation contradicts derivable Prisma fact (R5)."""


@dataclass
class PrismaField:
    name: str
    prisma_type: str
    nullable: bool
    is_list: bool
    is_id: bool = False
    is_unique: bool = False
    is_updated_at: bool = False
    has_default: bool = False
    default_value: object = None
    default_is_dynamic: bool = False  # now(), cuid(), uuid() -- not a literal
    is_relation_object: bool = False
    relation_fk_fields: tuple = ()  # local scalar FK column names, for relation-object fields


@dataclass
class PrismaModel:
    name: str
    fields: dict = _dc_field(default_factory=dict)
    unique_constraints: list = _dc_field(default_factory=list)

    def fk_target(self, fk_field_name: str):
        """Return the target model name for scalar FK column `fk_field_name`, or None."""
        for f in self.fields.values():
            if f.is_relation_object and fk_field_name in f.relation_fk_fields:
                return f.prisma_type
        return None


def _parse_default(raw: str):
    raw = raw.strip()
    if raw in ("now()",):
        return None, True
    if raw.endswith("()"):
        # cuid(), uuid(), autoincrement(), etc. -- dynamic, not a literal value
        return None, True
    if raw == "true":
        return True, False
    if raw == "false":
        return False, False
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1], False
    try:
        if "." in raw:
            return float(raw), False
        return int(raw), False
    except ValueError:
        return raw, False


def _parse_field_line(line: str) -> PrismaField | None:
    line = line.split("//", 1)[0].strip()
    if not line:
        return None
    head = _FIELD_HEAD_RE.match(line)
    if not head:
        return None
    name = head.group("name")
    prisma_type = head.group("type")
    is_list = bool(head.group("list"))
    nullable = bool(head.group("opt"))
    rest = line[head.end():]

    is_id = False
    is_unique = False
    is_updated_at = False
    has_default = False
    default_value = None
    default_is_dynamic = False
    is_relation_object = False
    relation_fk_fields: tuple = ()

    for attr_name, attr_args in _ATTR_RE.findall(rest):
        if attr_name == "id":
            is_id = True
        elif attr_name == "unique":
            is_unique = True
        elif attr_name == "updatedAt":
            is_updated_at = True
        elif attr_name == "default":
            has_default = True
            default_value, default_is_dynamic = _parse_default(attr_args)
        elif attr_name == "relation":
            is_relation_object = True
            m = _RELATION_FIELDS_RE.search(attr_args or "")
            if m:
                relation_fk_fields = tuple(
                    part.strip() for part in m.group(1).split(",") if part.strip()
                )
        # @db.* -- not needed for json-schema derivation, ignored

    return PrismaField(
        name=name,
        prisma_type=prisma_type,
        nullable=nullable,
        is_list=is_list,
        is_id=is_id,
        is_unique=is_unique,
        is_updated_at=is_updated_at,
        has_default=has_default,
        default_value=default_value,
        default_is_dynamic=default_is_dynamic,
        is_relation_object=is_relation_object,
        relation_fk_fields=relation_fk_fields,
    )


def parse_prisma_schema(path: Path) -> dict:
    """Parse `schema.prisma`, returning {model_name: PrismaModel}.

    Only `model` blocks are read (datasource/generator blocks are skipped).
    Brace-depth tracked per line so a model body can't be mis-terminated by
    a stray `}` inside an attribute (none occur in practice here, but this
    is cheap insurance).
    """
    text = path.read_text(encoding="utf-8")
    models: dict = {}

    lines = text.splitlines()
    i = 0
    while i < len(lines):
        m = re.match(r'^\s*model\s+(\w+)\s*\{\s*$', lines[i])
        if not m:
            i += 1
            continue
        model_name = m.group(1)
        depth = 1
        i += 1
        body_lines = []
        while i < len(lines) and depth > 0:
            depth += lines[i].count("{") - lines[i].count("}")
            if depth > 0:
                body_lines.append(lines[i])
            i += 1

        model = PrismaModel(name=model_name)
        for raw_line in body_lines:
            stripped = raw_line.strip()
            if stripped.startswith("@@unique"):
                mu = _BLOCK_UNIQUE_RE.search(stripped)
                if mu:
                    model.unique_constraints.append(
                        [p.strip() for p in mu.group(1).split(",") if p.strip()]
                    )
                continue
            if stripped.startswith("@@") or not stripped:
                continue
            pf = _parse_field_line(stripped)
            if pf is not None:
                model.fields[pf.name] = pf
        models[model_name] = model
    return models


def collect_unique_columns(models: dict) -> dict:
    """Return ``{model_name: {'single': [col, ...], 'composite': [[col, ...], ...]}}``.

    `single` lists columns carrying a field-level `@unique`; `composite` lists
    every `@@unique([...])` column group. The `@id` column is deliberately
    excluded -- it is always a generated cuid, so it can never be the key a
    deterministic test fixture is looked up by.

    This is a Prisma-only fact that intentionally does NOT flow into the
    derived JSON schema (`derive_property`): uniqueness constrains *writes*,
    not the JSON shape, and the Stage 2/4 golden references assert the derived
    shape byte-for-byte. Consumers (currently `generators_test.py`, for
    find-or-create idempotency in the Cypress populate helpers) read it
    straight off the parsed Prisma models instead.
    """
    out: dict = {}
    for model_name, model in models.items():
        out[model_name] = {
            "single": [f.name for f in model.fields.values() if f.is_unique and not f.is_id],
            "composite": [list(cols) for cols in model.unique_constraints],
        }
    return out


def parse_prisma_enums(path: Path) -> dict:
    """Parse Prisma ``enum`` blocks from schema.prisma.
    Returns {EnumName: ['member1', 'member2', ...]}."""
    text = path.read_text(encoding="utf-8")
    enums: dict = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        m = re.match(r'^\s*enum\s+(\w+)\s*\{\s*$', lines[i])
        if not m:
            i += 1
            continue
        enum_name = m.group(1)
        depth = 1
        i += 1
        members: list = []
        while i < len(lines) and depth > 0:
            depth += lines[i].count("{") - lines[i].count("}")
            if depth > 0:
                stripped = lines[i].strip().split("//", 1)[0].strip()
                if stripped and not stripped.startswith("@@"):
                    token = stripped.split()[0]
                    if token:
                        members.append(token)
            i += 1
        enums[enum_name] = members
    return enums


def _json_type_for(
    prisma_field: PrismaField,
    prisma_enums: dict | None = None,
) -> str:
    if prisma_enums and prisma_field.prisma_type in prisma_enums:
        return "string"  # Prisma nativeEnum maps to JSON string type
    if prisma_field.prisma_type not in _SCALAR_JSON_TYPE:
        raise SchemaDivergenceError(
            f"field '{prisma_field.name}': unsupported Prisma scalar type "
            f"'{prisma_field.prisma_type}' for JSON schema derivation"
        )
    return _SCALAR_JSON_TYPE[prisma_field.prisma_type]


def derive_property(
    model: PrismaModel,
    field_name: str,
    user_field_overrides: dict,
    prisma_enums: dict | None = None,
) -> dict:
    """Derive one property dict for `field_name` on `model` (Category A/B),
    then layer the user schema's Category C overrides (`user_field_overrides`)
    on top, verbatim, per fields: {...} in the new user_schema.yaml.
    """
    if field_name not in model.fields:
        raise SchemaDivergenceError(
            f"user schema declares field '{field_name}' on entity '{model.name}' "
            f"but no such column exists in the Prisma model"
        )
    pf = model.fields[field_name]
    base_type = _json_type_for(pf, prisma_enums)

    prop: dict = {}
    legacy_nullable_style = bool(user_field_overrides.get("_legacy_nullable_style"))
    # `_non_nullable_override`: a rare pre-existing exception (e.g.
    # room_type.capacity is `Int?` in Prisma but the legacy JSON schema
    # never allowed a null value for it) -- kept verbatim rather than
    # silently "fixed" by the derivation.
    treat_as_nullable = pf.nullable and not user_field_overrides.get("_non_nullable_override")
    if treat_as_nullable and legacy_nullable_style:
        prop["type"] = base_type
        prop["nullable"] = True
    elif treat_as_nullable:
        prop["type"] = [base_type, "null"]
    else:
        prop["type"] = base_type

    if pf.prisma_type == "DateTime":
        prop["format"] = "date-time"

    if prisma_enums and pf.prisma_type in prisma_enums:
        # Internal marker (not a real JSON schema keyword, stripped before
        # any client-facing output): lets downstream TS codegen (get_ts_type)
        # emit the exact string-literal union Prisma generates for this
        # nativeEnum, instead of a generic `string`, so values assigned into
        # a Prisma `data: {...}` write are structurally typed. The exposed
        # `type` stays "string" above (Class B: API/JSON shape unchanged).
        prop["_prisma_native_enum_type"] = pf.prisma_type

    fk_target = model.fk_target(field_name)
    if fk_target is not None and not user_field_overrides.get("_no_fk_pattern"):
        prop["pattern"] = _CUID_PATTERN

    # `default:` is NOT auto-derived from Prisma's `@default(...)` -- the
    # legacy schema sometimes omits it even when Prisma has one (e.g.
    # attachment.type has `@default(0)` in Prisma but no `default:` in the
    # legacy JSON schema), so its presence is a Category C, user-authored
    # decision. Only Prisma's *nullability* (used for `required`, below)
    # is Category A.
    if "default" in user_field_overrides:
        prop["default"] = user_field_overrides["default"]

    # Layer Category C overrides (everything the user schema specified for
    # this field) on top -- these are never derivable from Prisma, so a
    # plain dict.update is correct: nothing above should collide except
    # `default`/`_legacy_nullable_style`, already resolved, and
    # `x-relationship`, resolved next.
    _PRIVATE_KEYS = ("default", "_legacy_nullable_style", "_required", "_non_nullable_override", "_no_fk_pattern")
    for key, value in user_field_overrides.items():
        if key in _PRIVATE_KEYS:
            continue
        if key == "x-relationship":
            prop["x-relationship"] = _derive_relationship(
                model, field_name, fk_target, value
            )
            continue
        prop[key] = value

    return prop


_NOT_SET = object()


def _derive_relationship(model: PrismaModel, field_name: str, fk_target, user_rel: dict) -> dict:
    if fk_target is None:
        raise SchemaDivergenceError(
            f"entity '{model.name}' field '{field_name}': user schema declares "
            f"x-relationship but Prisma has no @relation for this column"
        )
    explicit_target = user_rel.get("target")
    if explicit_target is not None and explicit_target != fk_target:
        raise SchemaDivergenceError(
            f"entity '{model.name}' field '{field_name}': x-relationship.target "
            f"'{explicit_target}' does not match Prisma-derived target '{fk_target}' (R5)"
        )
    # `type` defaults to the Prisma-derivable "many-to-one", but a handful
    # of FK columns carry a semantic variant Prisma has no concept of at
    # all (e.g. "one-to-one_bridge" for internal bridge tables) -- that is
    # genuine Category C content, not a derivable fact to cross-check, so
    # an explicit `type` is used as-is rather than validated.
    rel = {"type": user_rel.get("type", "many-to-one"), "target": fk_target}
    label_field = user_rel.get("labelField", "name")  # DP-R4-1: default 'name'
    rel["labelField"] = label_field
    for key, value in user_rel.items():
        if key in ("target", "type", "labelField"):
            continue
        rel[key] = value
    return rel


def derive_raw_entity(
    model: PrismaModel,
    fields_spec: dict,
    prisma_enums: dict | None = None,
) -> dict:
    """Reconstruct the legacy raw-entity dict for `model`.

    `fields_spec` is the new user_schema.yaml entity's `fields:` map (dict
    of field_name -> override dict, in declaration order -- Python dicts
    preserve insertion order, which is relied on here to reproduce the
    original `properties:` key order for byte-identical generate.py output).
    """
    if "id" not in model.fields:
        raise SchemaDivergenceError(f"Prisma model '{model.name}' has no 'id' field")

    properties = {"id": {"type": "string", "pattern": _CUID_PATTERN}}
    required = ["id"]

    for field_name, overrides in fields_spec.items():
        prop = derive_property(model, field_name, overrides or {}, prisma_enums)
        properties[field_name] = prop
        pf = model.fields[field_name]
        # A field with a Prisma-declared default is usually not "required"
        # even if non-nullable at the DB level -- the default supplies the
        # value (e.g. permission.import, user.mfa_enabled, attachment.order).
        # Not universal though (attachment.type has @default(0) in Prisma
        # *and* is required in the legacy schema -- a real product
        # decision, not derivable), hence the `_required` override escape
        # hatch for exactly that kind of exception.
        forced_required = bool((overrides or {}).get("_required"))
        if forced_required or (not pf.nullable and not pf.has_default):
            required.append(field_name)

    return {"type": "object", "required": required, "properties": properties}
