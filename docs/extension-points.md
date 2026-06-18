# Extension points — hand-written files the generator does not own

Most files under `lib/`, `components/`, `app/`, and `cypress/` are **fully
generated** and rewritten on every `generate-code`. A small set of files are
**hand-written**: the generator either emits a one-time stub for you to fill in,
or never produces them at all. This page lists those files, when each is needed,
and how to create it.

## The one rule

| File kind | Commit it? | Hand-edit it? |
|-----------|-----------|---------------|
| **Generated** (overwritten each run) | No — it's reproducible | No — your edits are lost on regen |
| **Write-once stub** (generated once, then never touched) | **Yes** | **Yes — that's the point** |
| **Non-generated** (generator never emits it) | **Yes** | **Yes** |

Anything you hand-write must live in version control in the source of truth that
survives a clean rebuild. In an overlay setup (oshicry: the `prj/` directory that
`prj:sync` copies over the base), put project-specific hand-written files in the
overlay (`prj/lib/...`); base/shared files live in the generator repo itself.

If a hand-written file exists only in the working tree, a fresh checkout,
`cleanup`, or rebuild will lose it — **and the generator cannot recreate its
contents** (a write-once stub comes back blank).

## How you find out a file is needed

1. **Generation nudge.** When `generate-code` creates a new write-once stub it
   prints an `ACTION REQUIRED` block at the end listing each file to implement
   and commit. (It only fires the first time, when the stub is created.)
2. **Build/context warnings.** Declaring a virtual column with no resolver prints
   `Virtual column '<field>' on '<entity>' ... resolver expected at
   lib/<entity>/virtual_resolvers.ts`.

## The extension points

### 1. `lib/<entity>/virtual_resolvers.ts` — write-once

**When:** the entity has a *virtual column* — a field listed in `x-display.table`
(or otherwise surfaced) that is **not** a real DB property, so its value has to be
computed/fetched at read time (e.g. `tip_tx.created_by` resolved from
`creator_id` → `user.name`).

**What the generator does:** emits a blank stub once whose `resolveVirtualColumns`
returns empty values for every row. It is never overwritten and `cleanup` never
deletes it.

**What you do:** implement the bulk resolver and commit the file.

```ts
export async function resolveVirtualColumns(
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<Map<string, Record<string, string>>> {
  // key: row id → { <virtualField>: <value> }
}
```

Implement it in **bulk** (one query for all rows, keyed by id) — it runs once per
list render, not per row.

### 2. `lib/<entity>/service_after_create.ts` — write-once (optional)

**When:** you need a side effect after a record is created (audit row, outbound
notification, derived record). Optional — the default stub is a working no-op, so
leaving it untouched is fine. Commit it once you add logic.

### 3. `lib/comment/getters.ts`, `lib/comment/types.ts` (and similar base defs)

**Why these are not generated:** `comment` is a **base definition**, not a
generated entity. The generator only builds an entity (its `lib/`, `components/`,
`app/`, API, types/getters, etc.) for a definition that has a matching
`<name>_detail` definition carrying an `x-generate` block. `comment` is a bare
`definitions/comment` with no `comment_detail`, so it is a building block (the
polymorphic `commentable` target), not an entity — there is no generated
`lib/comment/`.

**Why proj_f has them but proj_c doesn't:** the `comment` definition is identical
in both, so this is not the generator behaving differently. The difference is the
application. oshicry (proj_f) surfaces comments as a first-class feature
(`cry_post` / channel comments, reactions) and so needs to **query and type
comments directly** — those data-access files are hand-written and committed in
`prj/lib/comment/`. The app-template (proj_c) reaches comments only through the
generated owner entities and the `commentable` bridge, so it never needs a
standalone `lib/comment` data layer and the files simply don't exist there.

**Rule of thumb:** if your app queries a non-generated base definition directly,
hand-write its `getters.ts`/`types.ts` and commit them to your SoT.

### 4. Base infrastructure (e.g. `cypress/support/e2e.ts`)

Static files that ship with the generator/app base and are not produced by
`generate-code` (Cypress bootstrap, shared support, etc.). They live in the base
repo, are already version-controlled there, and `cleanup` correctly leaves them
alone. Don't delete them; don't expect regeneration.

## Quick checklist when adding a feature

- Added a virtual column? → implement `lib/<entity>/virtual_resolvers.ts`, commit it.
- Need a post-create side effect? → fill in `lib/<entity>/service_after_create.ts`, commit it.
- Querying a base definition (`comment`, …) directly? → hand-write its
  `getters.ts`/`types.ts`, commit them.
- Watch the `ACTION REQUIRED` summary at the end of `generate-code`.
