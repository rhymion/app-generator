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

## Stage 3+ — simplified user schema

Once `user_schema.yaml` moves to the simplified `fields:`-only format (§4 of
the design doc), `build_user_schema.py` gains the actual Prisma-derivation
logic described in design doc §5. This doc will be updated when that lands.
