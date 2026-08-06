# Cleanup — removing generated files

`code_generator/cleanup.py` removes files that the generator produced. Run
it when you want to wipe a generated output tree or when you have changed
the schema and need old generated files to disappear.

`cleanup.py` must be pointed at the **built** schema
(`code_generator/.generated/json_schema.yaml`, the same file `generate.py`
consumes), not the hand-authored `code_generator/json_schema.yaml` — the
Stage-4 raw/view split synthesizes the `__`-prefixed raw entities
`extract_entities()` needs, and the hand-authored schema lacks them. Passing
a missing or wrong-shaped schema fails fast with an actionable error instead
of silently cleaning up nothing. The `npm run cleanup` / `npm run
cleanup:all` scripts build it automatically:

```bash
# Preferred — builds the schema, then runs cleanup with the safe defaults below
npm run cleanup       # --prune-orphans --keep-stubs
npm run cleanup:all   # --prune-orphans (stubs deleted too — full clean-slate)

# Direct invocation (schema must already be built)
python3 code_generator/build_user_schema.py code_generator/json_schema.yaml prisma/schema.prisma \
  --out code_generator/.generated/json_schema.yaml
python3 code_generator/cleanup.py code_generator/.generated/json_schema.yaml .
python3 code_generator/cleanup.py code_generator/.generated/json_schema.yaml . --keep-stubs
python3 code_generator/cleanup.py code_generator/.generated/json_schema.yaml . --prune-orphans
```

---

## Order matters: `cleanup` → `generate-code`, not the reverse

Running `cleanup` *immediately* after `generate-code` deletes every
just-written file: manifest-driven deletion only checks that a file's bytes
still hash-match the recorded value, and a file generated seconds ago always
does. `cleanup.py` detects this — when `.generated-manifest.json` is younger
than 60 seconds it prints a WARNING and pauses 3 seconds (Ctrl-C to abort)
before continuing; it does not block, since some automation may legitimately
chain the two on purpose. If you didn't mean to, this is your window to
cancel.

---

## How default cleanup works

### 1. Manifest-driven deletion (primary path)

When `generate-code` runs it writes a `.generated-manifest.json` file in the
output root. Each entry records the relative file path and a SHA-256 hash of the
content at generation time. Cleanup reads this manifest and deletes every listed
file — **only when the file's current bytes still hash to the recorded value**.
If you have edited a file since it was generated, the hash no longer matches and
cleanup preserves the file.

After all listed files are removed, cleanup deletes the manifest itself.

Appended files (`messages/*.json`, `lib/site-config.ts`,
`app/[locale]/@sidebar/page.tsx`) are **never in the manifest** and are never
deleted outright. Cleanup strips only the generator-injected entries from them,
preserving any surrounding content you wrote by hand.

### 2. Schema-derived fallback (legacy)

When no manifest is present (trees generated before manifests existed), cleanup
re-derives expected file paths from the current schema and deletes them
directly. This is best-effort: path drift between generator versions can leave
files behind or, in theory, delete a file that was moved to a new location.

The manifest path is always preferred; the fallback is a safety net for old trees.

---

## What cleanup preserves

| Mechanism | Files affected | How it works |
|-----------|---------------|-------------|
| **Hash guard** (manifest mode) | All manifest-listed files | File is kept when `sha256(on-disk) ≠ sha256(recorded)` — any edit, even reformatting, keeps the file. |
| **`AUTO-GENERATED` marker check** | Schema-global files (e.g. `lib/dashboard/catalog.ts`) | File is deleted only when the first five lines contain `AUTO-GENERATED`. Strip that header to keep your fork. |
| **Boilerplate equality check** | `lib/<entity>/service_after_create.ts` | Deleted only when the file still exactly matches the original stub template. Any user content preserves it. |
| **`--keep-stubs` flag** | `lib/<entity>/service_validation.ts`, `components/<entity>/form_validation.ts` | These stubs are skipped when `--keep-stubs` is passed — useful if you have not yet customized them but do not want to lose an empty file you rely on. |
| **`HANDWRITTEN_ALLOWLIST`** | Files listed in `cleanup.HANDWRITTEN_ALLOWLIST` | Never deleted by `--prune-orphans`, regardless of schema state. |

---

## Orphan files — what they are and why they linger

An **orphan** is a generated file whose entity no longer appears in the current
schema. For example: you had entity X in the schema, ran `generate-code`, then
removed entity X from the schema and ran `generate-code` again. The second run
writes a new manifest that does not mention X's files; X's files are therefore
invisible to default cleanup and remain on disk.

This is **intentional**. The generator's docstring states the design goal: the
regular cleanup pass knows only about today's entities, so prior-schema
artefacts linger until you explicitly sweep them. This prevents accidental mass
deletion if you run cleanup in the wrong state.

To remove orphan boilerplate, use `--prune-orphans`.

---

## `--prune-orphans` — sweeping stale entity boilerplate

`--prune-orphans` runs an additional scan after the regular cleanup pass. It
looks for generator-shaped directories and files that no longer correspond to
any entity in the current schema, then deletes them.

### What it sweeps

| Path pattern | Detection signal | Notes |
|-------------|-----------------|-------|
| `lib/<entity>/types.ts`, `getters.ts`, `actions.ts`, `service.ts`, `chart-getters.ts` | Presence of `types.ts` or `getters.ts` in the directory | Identifies an entity lib dir; system lib dirs lack these names and are skipped. |
| `lib/<entity>/service_validation.ts` | Same detection; skipped if `--keep-stubs` | |
| `lib/<entity>/service_after_create.ts` | Same detection; boilerplate equality check applies | Kept if the user customized it. |
| `components/<entity>/FormUpsert.tsx`, `FormView.tsx` | Presence of `FormUpsert.tsx` or `FormView.tsx` | |
| `components/<entity>/form_validation.ts` | Same detection; skipped if `--keep-stubs` | |
| `components/<entity>/column_def.tsx` | Any components dir not in schema, or entity whose children list is now empty | |
| `cypress/support/<entity>/*.ts` | Entity dir not in schema; `AUTO-GENERATED` marker required | |
| `app/[locale]/docs/<entity>/page.mdx` | Entity dir not in schema | |
| `docs/generated/<entity>.md` | Stem not in schema | |

### What it does NOT sweep

`--prune-orphans` does not currently remove generated **application pages** or
**API routes** for orphaned entities:

- `app/[locale]/<entity>/page.tsx` (list page)
- `app/[locale]/<entity>/new/page.tsx`, `edit/[id]/page.tsx`, `view/[id]/page.tsx`
- `app/api/<entity>/route.ts`
- `cypress/e2e/<entity>.cy.ts`

If you remove an entity from the schema and these files remain after running
`--prune-orphans`, delete them manually. The generator does not auto-detect
these as orphans because page directories may also contain hand-written content,
so a safe automated check is non-trivial.

---

## When to use `--prune-orphans`

`npm run cleanup` and `npm run cleanup:all` both pass `--prune-orphans` by
default, so routine use already sweeps stale `lib/<entity>/` and
`components/<entity>/` boilerplate left behind by a schema change — you do
not need to pass it yourself when using the npm scripts. It matters mainly
for **direct** `cleanup.py` invocation, where it must be passed explicitly
after removing an entity from the schema and regenerating.

---

## Symptom analysis: boilerplate remaining after schema change

**Symptom:** after removing an entity from the schema, running `generate-code`,
and then running `cleanup.py` **without `--prune-orphans`** (e.g. a direct
invocation, or an npm script predating the current defaults), per-entity
files such as `lib/<entity>/types.ts` or `components/<entity>/FormUpsert.tsx`
still exist on disk.

**Root cause:** this is **designed behavior** — the regular (non-orphan-pruning)
cleanup pass only deletes files it knows about from the current manifest or
schema. Orphan files from removed entities are outside that scope.

**Conclusion: [A] — designed behavior, not a bug.**

**Advice:** `npm run cleanup` / `npm run cleanup:all` already pass
`--prune-orphans` by default, so this symptom should not occur via the npm
scripts. For a direct `cleanup.py` invocation, always follow a schema entity
removal with:

```bash
python3 code_generator/cleanup.py code_generator/.generated/json_schema.yaml . --prune-orphans
```

This sweeps `lib/<entity>/` and `components/<entity>/` boilerplate for any
entity that no longer exists in the schema. For app pages
(`app/[locale]/<entity>/`, `app/api/<entity>/`) that also need removal,
delete them manually — `--prune-orphans` does not cover those paths.
