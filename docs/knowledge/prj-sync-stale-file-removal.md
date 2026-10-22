# prj:sync removes files that left `prj/`

`scripts/prj_sync.py` copies a consumer's `../prj` into this generator project.
When a hand-written file is renamed or deleted inside `prj/`, the copy at its
old destination path would otherwise stay behind and keep code that still names
pre-rename identifiers (for example a Prisma model), which breaks the type
check (Issue #619).

## How it works

- Every file copied verbatim is recorded in `.prj-sync-manifest.json` at the
  project root (path -> sha256 of the copied file). The file is gitignored: it
  describes this checkout's own sync history.
- On the next run, before copying, each recorded destination whose source no
  longer exists in `prj/` is removed, and directories that become empty are
  removed with it. The run prints `prj:sync: removed <path> (no longer in prj/)`.
- A recorded destination is removed only while its content still hashes to the
  recorded value. If `generate-code` or a person changed it since the sync, it
  stays and the run prints `prj:sync: WARNING kept <path>`; delete it by hand
  if it is stale. A kept file is no longer tracked, so later runs leave it
  alone.

## What is never removed

- A file `prj:sync` did not copy itself, including everything the generator
  writes in the same directories.
- `messages/*.json`: they are merged into the generator defaults, so removing
  one would remove the defaults too.
- Anything outside the project root, whatever the manifest says.
- Anything at all when `../prj` is absent.

The first run after this behavior appeared has no manifest and removes nothing;
the manifest is written by that run, so a rename after it is followed.
