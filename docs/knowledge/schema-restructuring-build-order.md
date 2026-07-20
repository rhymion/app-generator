# JSON Schema Restructuring — Build Order (cmd_395)

Tracks the migration described in `planning/cmd395-schema-restructuring-design.md`
(cmd_395, Lord's ruling: proceed with Stages 1–4; Stage 5 CUID→UUID deferred).

## Stage 1 (cmd_406, current) — `build_user_schema.py` added, not yet wired in

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

## Stage 2 (future) — switch invocation to the intermediate schema

Once Stage 2 lands, the build order becomes:

```bash
prisma generate                    # (unchanged)
python3 code_generator/build_user_schema.py \
  code_generator/json_schema.yaml prisma/schema.prisma \
  --out code_generator/.generated/json_schema.yaml
python3 code_generator/generate.py code_generator/.generated/json_schema.yaml ./
next build
```

`package.json`'s `generate-code` script (currently
`python3 code_generator/generate.py code_generator/json_schema.yaml ./`) and
`prj:sync`/`vercel-build` chains will need the `build_user_schema.py` step
inserted before `generate.py` at that point. Not done in Stage 1.

## Stage 3+ — simplified user schema

Once `user_schema.yaml` moves to the simplified `fields:`-only format (§4 of
the design doc), `build_user_schema.py` gains the actual Prisma-derivation
logic described in design doc §5. This doc will be updated when that lands.
