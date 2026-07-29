# JSON Schema Restructuring — Build Order (cmd_395)

Tracks the migration described in `planning/cmd395-schema-restructuring-design.md`
(cmd_395, decided: proceed with Stages 1–4; Stage 5 CUID→UUID deferred).
Sections below are numbered in the order each increment landed, not as an
ongoing naming convention for new work — see "Current entity-naming
convention" for what `json_schema.yaml` looks like today and why it no
longer uses the numbering scheme in its own vocabulary. Stage 5 (switching
the `@default(cuid())` primary-key convention to UUID) has not started;
`prisma/schema.prisma` still uses `cuid()` throughout.

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

## Stage 2 (cmd_407) — invocation switched to the intermediate schema

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

## Stage 3 (cmd_408) — simplified user schema + Prisma derivation

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

**Superseded naming, still-current architecture**: the `{model}_detail`
paired-naming convention shown in this section's examples above (e.g.
`role_detail:`) is no longer how entities are written — see "Current
entity-naming convention" below. Everything else this section describes
(the simplified `fields:`-based user schema, Prisma-derivation, the
Category A/B/C/D split, the escape-hatch keys, `schema_deriver.py`) is
unchanged and still exactly how the pipeline works today; only the key
naming that tells the builder "this entity needs a raw/view split" changed
in the next increment.

## Current entity-naming convention (cmd_409) — `_detail` suffix retired

This is the increment the design doc and the code itself (module
docstrings in `code_generator/build_user_schema.py` and
`code_generator/convert_to_user_schema.py`, the
`code_generator/tests/fixtures/stage4_reference.yaml` test fixture) label
"Stage 4." That label is recorded here once, since several code comments
point a reader here by that name; the rest of this section describes the
change by what it does, not by that number.

### Old form vs. new form

Stage 3 already derived the raw entity from Prisma — nothing raw was
hand-typed by that point (see above). What Stage 3 still required was a
name suffix on the *view*, so the builder knew which bare-named key to
synthesize the derived raw entity under. Verified directly against the
pre-cmd_409 commit (`git show 5963dd2^:code_generator/json_schema.yaml`,
`git show 5963dd2^:code_generator/build_user_schema.py`) — the user wrote
only this, for the live `role` entity (`invalidate`/`search` flags trimmed
for brevity, same as the current-form block below):

```yaml
# Stage 3 form (superseded) — do not write new entities this way.
role_detail:                # the only entity the user wrote
  x-generate: { list: true, view: true, new: true, edit: true, delete: true, api: true, test: true }
  x-audit: true
  x-relationships:
    users: { type: many-to-many, target: user }
  x-import-key: [name]
  fields:
    name: { minLength: 1 }
    description: {}
  required:
    - users
  properties:
    users: { type: array, x-outputType: list, items: { $ref: "#/definitions/user" } }
```

`build_user_schema.py` derived `role`'s `id`/`name`/`description` from the
Prisma `role` model and synthesized it, **implicit and never hand-authored,
under the bare `role:` key** — the same key `role_detail:`'s own `allOf`
wrapper (`$ref: "#/definitions/role"`) pointed at. That bare `role:` key
is exactly the one a Stage-4-era author now wants to use for the view
itself, which is the collision this increment exists to resolve.

Today (verbatim from `code_generator/json_schema.yaml`, `invalidate`/
`search` flags trimmed for brevity) the same content is written under
`role:` directly — the same key that used to hold the synthesized raw
entity — and the raw entity moves to the reserved `__role:` key instead:

```yaml
# Current form.
role:
  x-generate: { list: true, view: true, new: true, edit: true, delete: true, api: true, test: true }
  x-audit: true
  x-relationships:
    users: { type: many-to-many, target: user }
  x-import-key: [name]
  fields:
    name: {}
    description: {}
  required:
    - users
  properties:
    users: { type: array, x-outputType: list, items: { $ref: "#/definitions/user" } }
```

The only functional differences from the Stage 3 form above: the key is
`role` instead of `role_detail`, the derived raw entity's key is now
`__role` instead of the (collision-prone) bare `role`, and `fields.name`
dropped its `minLength: 1` (an unrelated, later content edit, not part of
this renaming). `code_generator/json_schema.yaml` (the live default
schema) has zero `_detail`-suffixed entity names today — confirmed via
`grep -c "_detail:"`, which returns 0.

### How the split is decided now: content, not name

`build_user_schema.py` (`_has_view_level_config()`) decides whether a
Prisma-model-named entity needs a raw/view split by checking whether it
carries at least one Category D / view-level key (`x-generate`, `x-audit`,
`x-relationships`, `x-search`, `x-custom-components`) — not by looking for
a name suffix, since there is no longer a suffix to look for. Three
outcomes, all handled in `build_intermediate_schema()`
(`code_generator/build_user_schema.py:251-285`):

1. **Paired** — a Prisma-model entity with at least one view-level key
   (e.g. `role`, `user`, `organization`). The machine-derived raw entity
   is synthesized from Prisma and written to a **reserved `__`-prefixed
   key** (`__role`) so it can never collide with a user-chosen name; the
   user's own entry becomes the view, wrapped as
   `allOf: [{$ref: "#/definitions/__role"}, {...}]`. Category C
   entity-level annotations (`x-import-key`, `x-display`,
   `x-readonly-fields`, `x-internal`, `x-approval`, `x-approval-lines`,
   `x-ledger-source`, `x-splittable`, `x-reservation`, `x-gdpr-mode`) move
   from the user's entry onto the synthesized raw entity, matching where
   the legacy `_detail` split kept them.
2. **Standalone raw** — a Prisma-model entity with no view-level key at
   all (e.g. `comment`, `reaction`, `attachment`). Fully reconstructed
   from Prisma in place, with the user's own annotations merged directly
   onto it — no `__`-prefixed sibling, since there is nothing to
   disambiguate it from.
3. **Pass-through** — an entity name that is *not* a Prisma model (e.g.
   `setting`, a second view over the `user` model). Copied through
   unchanged; it never had raw boilerplate to eliminate.

Entity-name validation (`_validate_entity_names()`) runs first and rejects
two mistakes outright: a user-authored entity name starting with the
reserved `__` prefix, and a Prisma-model-named entity written in the
pass-through (`allOf`-wrapper) shape (that shape is reserved for
non-model names like `setting`).

One more build-order detail not covered by Stages 1–3: before any of the
above runs, `build_user_schema.py` merges in
`code_generator/json_schema_internal.yaml` (cmd_438 Batch3) — the
framework-provided default entities (`approvable`, `commentable`,
`attachable`) — for any entity name the app's own `json_schema.yaml`
doesn't already define; an app's own definition always wins (whole-entity
override, not a deep merge). See `docs/knowledge/schema-yaml-configuration.md`
§1 for the full reference on this file and its entities.

### What generator invocation looks like — unchanged

The build order and every script that reaches it are the same as Stage 2
left them:

```bash
prisma generate                    # (unchanged)
npm run generate-code              # build_user_schema.py, then generate.py against
                                    # code_generator/.generated/json_schema.yaml
next build
```

`package.json`'s `generate-code` script is still the exact command Stage 2
introduced — `build_user_schema.py` followed by `generate.py` against the
`.generated/` intermediate file — and `cleanup.py`/`check_generated.py`
still read `code_generator/json_schema.yaml` directly (verified against
the live `package.json`). What changed is entirely inside
`build_user_schema.py`: which key a raw entity ends up under, and how the
need for a raw/view split is detected. `generate.py` and
`generate_types.py`'s `extract_entities()` were taught the `__`-prefixed
convention (walking `allOf` `$ref` chains to resolve a view to its raw
entity, `_resolve_raw_key()`) so the shape of the intermediate schema
`generate.py` consumes, and therefore every generated application file, is
unaffected.

**Verified empirically** (this task, against a checkout of this repository
at commit `e6da0cb`): ran
`python3 code_generator/build_user_schema.py code_generator/json_schema.yaml prisma/schema.prisma --out code_generator/.generated/json_schema.yaml`
directly — confirmed the output contains `__user`/`user`, `__role`/`role`,
`__organization`/`organization`, `__permission`/`permission`,
`__approval_flow`/`approval_flow`, `__approvable`/`approvable`,
`__commentable`/`commentable` pairs plus the `setting` pass-through, exactly
as described above. Then ran
`python3 code_generator/generate.py code_generator/.generated/json_schema.yaml <scratch-dir>`
against that output — it completed with "Code generation complete!" and
wrote a 200-file manifest, the same file count Stage 2/3's own golden-diff
baselines cite. Also ran the project's own test suite for this path —
`python3 -m pytest tests/test_build_user_schema_roundtrip.py
tests/test_convert_to_user_schema.py` from `code_generator/` — 14 passed,
0 failed, including the `stage4_reference.yaml` fixture comparison that
pins this exact raw/view/pass-through behavior.

### Migrating an existing `_detail`-suffixed schema

A project whose `json_schema.yaml` still uses the fully legacy,
pre-Stage-3 shape — a hand-typed `{model}:` raw entity (full `type`/
`required`/`properties`) paired with a `{model}_detail:` view — can
convert automatically, straight to the current single-file form; hand-
editing ~94 entities is exactly the transcription risk the automated
converter exists to avoid (Stage 3, above). This is `convert_to_user_schema.py`'s
actual input contract, verified against
`code_generator/convert_to_user_schema.py:192-196` (`paired_raw_names`
only recognizes a `{model}_detail` key when a **bare `{model}` key with
its own content also exists** in the same file — the Stage 3-only
in-between shape, where the raw entity was never written to
`json_schema.yaml` at all, has nothing for this bare-key check to find):

```bash
python3 code_generator/convert_to_user_schema.py \
  <legacy_json_schema.yaml> <prisma/schema.prisma> --out <new_json_schema.yaml>
```

Confirmed by reading the current implementation
(`code_generator/convert_to_user_schema.py:189-223`): the converter
already folds a `{model}`/`{model}_detail` pair into a single `{model}`
key in its output today — i.e. it emits the current single-file form, not
the Stage 3 paired form its own `--help` text and module docstring still
describe ("Stage 3 simplified user_schema.yaml format" — a stale label in
the tool's own help text, not the tool's actual current output shape;
out of scope to fix here since this task is docs-only). Concretely, for
each converted entity:

- `{model}_detail`'s key is dropped; its `x-generate` and other Category D
  keys move onto `{model}` directly.
- The old standalone `{model}:` raw entity (full `type`/`required`/
  `properties`) is dropped entirely — `build_user_schema.py` now
  re-derives it from Prisma at build time under `__{model}`.
- Category C entity-level annotations that lived on the old raw `{model}:`
  entry move onto the new `{model}:` entry.
- A `labelField` other than the Prisma-derivable default (`name`), or any
  other Category C/D field-level override, is preserved under `fields:`.

After conversion, run `build_user_schema.py` against the result (as shown
in "What generator invocation looks like" above) to confirm it derives
cleanly — a `SchemaDivergenceError` (R5, unchanged by this stage) surfaces
any field-level fact the converted schema asserts that contradicts
Prisma's own `@relation`/column definitions.

### The old `{model}_detail` shape is not tolerated by the generator core anymore

Unlike Stage 2 (which needed no `generate.py` change at all), this
increment's cmd_409 batch2 commit is titled "retire `_detail` suffix in
**generator core**" — `generate_types.py`'s `extract_entities()` itself
changed, not just `build_user_schema.py`. Verified directly against
`code_generator/tests/test_extract_entities.py`: its `_detail_entity()`
test helper — despite the name, a leftover from before this rename — now
builds the **current** `__`-prefixed shape (`allOf`-refs
`#/definitions/__{base_name}`, docstring: *"Minimal view entity that
allOf-refs the raw ('__'-prefixed) base"*), not the old bare-name shape. A
`{model}_detail` view whose `allOf` still `$ref`s the bare `{model}` key
(the Stage 3 shape shown above, where the synthesized raw entity lived
under the bare name) has no raw/view resolution path in the current
`_resolve_raw_key()` — that function's `base_models` set only recognizes
`__`-prefixed keys — so it does not round-trip through `generate.py`
correctly today. **There is no live fallback for the Stage 3 (or earlier)
shape**: convert first (see above), then run `build_user_schema.py` +
`generate.py`.

`extract_entities()`'s third `x-generate` lookup fallback
(`def_key in base_models and defs[def_key].get('x-generate')`) is a
narrower thing entirely: a `__`-prefixed entity that itself carries
`x-generate` with no separate view sibling at all, confirmed via
`test_extract_entities.py`'s `test_parent_only_entity_included`. This is
distinct from the plain-keyed "standalone raw" case above (`comment`,
`reaction`, `attachment`, which resolve through the *first* lookup
attempt, `x-generate` directly on their own plain key) — not a path for
resurrecting an unconverted `{model}_detail` schema.
