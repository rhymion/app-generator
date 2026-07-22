# JSON Schema Restructuring — Build Order (cmd_395)

Tracks the migration described in `planning/cmd395-schema-restructuring-design.md`
(cmd_395, Lord's ruling: proceed with Stages 1–4; Stage 5 CUID→UUID deferred).

## Stage 1 (cmd_406) — `build_user_schema.py` added, not yet wired in

`code_generator/build_user_schema.py` exists as a standalone tool:

```bash
python3 code_generator/build_user_schema.py \
  <user_schema.yaml> <prisma/schema.prisma> --out code_generator/.generated/json_schema.yaml
```

It is **not yet called** by `npm run generate-code` or any other script — the
generator still reads `code_generator/json_schema.yaml` directly, unchanged.
At this stage the tool is an identity transform: given the current
`json_schema.yaml` (still in the legacy raw-entity + `_detail` format) as
input, it reproduces it byte-for-byte as output (see
`code_generator/tests/test_build_user_schema_roundtrip.py`). Prisma-driven
derivation of raw entities lands in Stage 3, once the user-authored format is
simplified (design doc §12 Stage 3).

`code_generator/.generated/` is gitignored — it is a build artifact, never
hand-edited, and rebuilt from source on every build (same policy as generated
application code).

## Stage 2 (cmd_407, current) — invocation switched to the intermediate schema

`package.json`'s `generate-code` script now runs `build_user_schema.py` before
`generate.py`, pointing `generate.py` at the intermediate schema instead of the
user-authored file directly:

```json
"generate-code": "python3 code_generator/build_user_schema.py code_generator/json_schema.yaml prisma/schema.prisma --out code_generator/.generated/json_schema.yaml && python3 code_generator/generate.py code_generator/.generated/json_schema.yaml ./",
```

Build order:

```bash
prisma generate                    # (unchanged)
npm run generate-code              # build_user_schema.py, then generate.py against
                                    # code_generator/.generated/json_schema.yaml
next build
```

No source-code change to `generate.py` was needed — it already read its schema
path from `sys.argv[1]` (positional). `cleanup.py` / `check_generated.py` still
point at `code_generator/json_schema.yaml` directly; they inspect entity
definitions rather than drive the generator, and that file's content is
unchanged by this stage, so no switch was needed there.

Every script that reaches `generate.py` goes through the `generate-code` npm
script (`setup`, `dev:full`, `build:full`, `test:e2e*`, `python-generate` →
`vercel-build`), so this single edit covers the whole invocation surface;
`.vscode/launch.json`'s standalone debug entry (a personal debugging
convenience, not part of the build/CI pipeline) was left pointed at the
legacy path and is out of scope.

Golden diff verified zero two ways: byte-for-byte `diff -rq` across all 200
generated files, and independent `.generated-manifest.json` sha256 hash-set
comparison, both between the pre-switch (direct `json_schema.yaml`) and
post-switch (`.generated/json_schema.yaml`) invocations.

## Stage 3 (cmd_408, current) — simplified user schema + Prisma derivation

`code_generator/json_schema.yaml` is now in the simplified format (§4 of the
design doc): the ~49 raw entity definitions (`type`/`required`/full
`properties`) are gone. Only non-derivable (Category C/D, §3) annotations
remain, keyed by entity and, for field-level annotations, nested under a
`fields:` map. `build_user_schema.py` gained the Prisma-derivation logic
(new module `code_generator/schema_deriver.py`) that reconstructs the
legacy-shape intermediate schema from Prisma + these annotations, per §5/§7.

Two supporting pieces:

- `code_generator/schema_deriver.py` — a small Prisma DSL reader
  (`parse_prisma_schema`) plus `derive_raw_entity`/`derive_property`
  (Category A/B derivation) and the R5 divergence check
  (`SchemaDivergenceError`, raised when a user-schema `x-relationship.target`
  contradicts Prisma's actual `@relation` target, or a `fields:` entry names
  a column that doesn't exist in the Prisma model at all).
- `code_generator/convert_to_user_schema.py` — the automated converter
  (design doc §4/§12 "automated schema converter", explicitly required
  instead of hand-rewriting): takes the legacy fully-specified format and
  produces the new simplified format, so migration never depends on manual
  transcription.

A handful of pre-existing, real-world exceptions to "purely mechanical"
Category A/B derivation surfaced while proving this against both proj_b's
own schema and proj_c's (much larger, real) schema, and are preserved via
narrow escape-hatch keys in a field's `fields:` override rather than
silently "corrected":

- `_required: true` — a field the legacy schema marks required despite a
  Prisma-level default (e.g. `attachment.type`, which has `@default(0)` in
  Prisma yet was always required in the legacy schema).
- `_non_nullable_override: true` — a field Prisma allows null on but the
  legacy schema never did (e.g. `room_type.capacity`, `Int?` in Prisma).
- `_legacy_nullable_style: true` — reproduces the legacy schema's rarer
  `type: X` + `nullable: true` representation instead of the more common
  `type: [X, null]` array form (both are Category A, only the
  representation differs; one field, `approvable.approved_at`).
- `_no_fk_pattern: true` — an FK column the legacy schema never annotated
  with the CUID `pattern` despite the relation being real (e.g.
  `inventory.location_id` in proj_c).
- `x-relationship.type` may be an explicit non-derivable value (e.g.
  `one-to-one_bridge` for internal bridge tables in proj_c) rather than
  the Prisma-derivable default `many-to-one` — kept as an override, not
  cross-checked, since Prisma has no concept of it.

`default:` is *never* auto-derived from Prisma's `@default(...)` even when
one exists — the legacy schema sometimes omits it anyway (e.g.
`attachment.type` has `@default(0)` in Prisma but no `default:` in the
legacy JSON schema), so its presence is treated as a Category C,
user-authored decision, kept verbatim when present.

The view entity's embed declarations (`required:`/`properties:` for
many-to-many / many-to-one relation arrays) are copied through verbatim
from the user schema rather than re-derived from `x-relationships` --
Sec.7's R4 table only classifies the relation's existence/target as data;
the embed shape around it (`x-outputType`, exactly which names are
`required`, structural one-offs like `commentable_detail`'s plain Prisma
back-relation with no `x-relationships` entry at all) is not reliably
mechanical (a pre-existing `required: [approver_role, preceding_transitions]`
typo on `approval_flow_detail`, where `preceding_transitions` matches no
actual property key, proves it isn't). This keeps the *only* genuinely
derivable part -- the raw entity -- the only part actually derived, which
is what §4's ~1,400-line/43% estimate is about in the first place.

Golden diff verified zero, the same two ways as Stage 2 (byte-for-byte
`diff -rq` and independent `.generated-manifest.json` sha256 hash-set
comparison across all 200 generated files), between the Stage 2 baseline
(`generate.py` run directly against the snapshotted pre-Stage-3 schema,
`code_generator/tests/fixtures/stage2_reference_json_schema.yaml`) and the
Stage 3 pipeline (`build_user_schema.py` + `generate.py` against the new
simplified `json_schema.yaml`). Additionally verified against proj_c's real
(3,257-line) schema: `convert_to_user_schema.py` + `build_user_schema.py`
round-trip to a result semantically identical (deep-equality, zero diffs)
to proj_c's original schema, with a measured 1,195-line / 36.7% reduction
(2,062 lines from 3,257) -- close to, though somewhat under, the design
doc's ~1,400-line/43% estimate.
