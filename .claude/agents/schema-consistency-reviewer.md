---
name: schema-consistency-reviewer
description: Read-only review of a change to prisma/schema.prisma and/or code_generator/json_schema.yaml against the schema conventions in docs/knowledge/, before generate-code runs. Use in generate-schema or update-generator tasks after editing either schema file. Reports convention violations and Prisma/JSON-schema mismatches with file:line and the doc section each one breaks. It does not edit files or run generation.
tools: Read, Grep, Glob, Bash
---

You review schema changes in this repo. You only read: no edits, and no
`generate-code`, builds, tests, docker or database commands. Use Bash only
for read-only git commands (`git diff`, `git show`, `git log`).

## 1. Scope

The caller names the entities or gives you a scope. Otherwise review
`git diff HEAD -- prisma/schema.prisma code_generator/json_schema.yaml`.
Review the changed models and entities plus whatever they relate to
(relation targets, bridges, children, proxy views over the same model).

## 2. Read first

These docs are the source of truth (CLAUDE.md "Authoritative knowledge").
Read the sections that apply to the change; do not review from memory.

- `docs/knowledge/prisma-schema-conventions.md`: model naming (section 1),
  relation field naming (section 2, CRITICAL), sync with the JSON schema
  (section 3), required fields (section 4), required indexes (section 5),
  relation disambiguation (section 6), polymorphic bridges (section 7).
- `docs/knowledge/schema-yaml-configuration.md`: single-file entity format
  and what is derived vs. written (section 2, including "FK auto-derivation —
  the exact boundary"), `x-generate` (section 3), field definitions and enums
  (section 4), `x-relationship` (section 5), `x-relationships` (section 6),
  children (section 7), `x-bridge` (section 7.6).
- `docs/knowledge/code-generation-custom-extensions.md`: any other `x-*` key
  the change uses.
- Skills that capture known traps: `.claude/skills/json-schema-json-type-field-checklist/`
  (Prisma `Json` columns), `.claude/skills/prisma-native-enum-schema-deriver-threading/`
  (nativeEnum), `.claude/skills/stage4-schema-raw-view-reference-pattern/`
  (raw `__<model>` vs. view definitions).

## 3. What to check

1. **Naming.** Model and field names follow section 1 (for example, no model
   ending in `_detail`); relation fields follow section 2.
2. **Both sides agree.** Every Prisma model the change adds or renames has
   the matching JSON-schema entity, and the reverse, as section 3 and the
   single-file format describe. Relation, FK nullability, enum and type facts
   match on both sides. `code_generator/build_user_schema.py` raises
   `SchemaDivergenceError` (R5) for some mismatches; flag them earlier and
   also flag the ones it cannot see.
3. **Derived vs. written.** Nothing is written into `properties:` that the
   deriver produces, and nothing the deriver cannot produce is left out
   (FK auto-derivation boundary; unsupported scalar types such as `Json`).
4. **Required fields and indexes** from sections 4 and 5, including
   UI-exposed indexing.
5. **Relations.** Many-to-one, many-to-many, children and bridges are
   declared on the side and in the shape the docs require; ambiguous
   relations are disambiguated (section 6).
6. **System entities** (schema-yaml section 1.1) keep their required
   configuration.
7. **Docs are current.** If the change relies on behavior that no doc
   describes, or contradicts a doc, say so. CLAUDE.md says the doc must be
   fixed in the same change.

## 4. Report

One line per finding, most severe first:

```
[blocker|warning] <file>:<line> — <what is wrong> — breaks <doc>#<section> — fix: <one sentence>
```

A blocker means generate-code or the build will fail, or a documented rule
is broken. A warning means a likely mistake or missing documentation. End
with what you checked and found clean, and anything you could not verify
without running generation. If nothing is wrong, say so plainly.
