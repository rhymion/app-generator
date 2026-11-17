# prj:sync adds a consumer's npm dependencies from `prj/package.extra.json`

A consumer's own code under `prj/` may need an npm package that not every
generated app should carry, for example an AI agent SDK that only one app uses.
Adding it to this repo's `package.json` would ship it to every consumer. The
consumer instead declares it in `prj/package.extra.json`, and `prj:sync` adds
it to this project's `package.json`.

A consumer cannot use its superproject's own `package.json` for this: Vercel's
root directory is `app-generator` (`scripts/vercel-setup.sh`), so only
`app-generator/node_modules` is installed and bundled.

## File format

```json
{
  "//": "Agent SDK used by prj/lib/agent/",
  "dependencies": {
    "@anthropic-ai/sdk": "^1.2.0"
  },
  "devDependencies": {
    "@types/some-lib": "^1.0.0"
  }
}
```

- Only `dependencies` and `devDependencies` are accepted. `"//"` is allowed for
  a comment (the npm convention). Any other key, a name that is not a valid npm
  package name, an empty version, or a name listed in both sections fails the
  sync and leaves `package.json` unchanged.
- Versions are any npm version spec. Pin exact versions when the build must be
  reproducible: `npm install` resolves a range at sync time.

## Behavior

- Each entry is added to the same section of `package.json`, and the section is
  kept sorted (npm's own order). The file itself is never copied.
- A name the generator already declares with the same version is left as it
  is and not recorded as the consumer's. A different version, or the name in
  the other section, is refused with an `ERROR` line and exit code 1; the
  generator's version is kept, because the generator's own code was built and
  tested against it. Change the version in app-generator itself if the
  consumer needs another one. The remaining entries are still merged.
- `npm install --no-audit --no-fund` runs in this project when `package.json`
  changed, or when an added package is missing from `node_modules`. It updates
  `package-lock.json`. A failed install fails the sync. On Vercel this runs
  inside `vercel-build`, after Vercel's own install, so the build has network
  access to the registry.
- The entries the sync added, and the hash of the `package.json` it wrote, are
  recorded under `package_extra` in `.prj-sync-manifest.json`. On the next run
  they are taken out again before the current entries are added, so an entry
  dropped from `package.extra.json` (or the whole file deleted) is removed from
  `package.json`. This happens only while `package.json` still hashes to what
  that sync wrote. A `package.json` replaced since (a submodule update, a hand
  edit) is left as it is; an entry the consumer no longer lists is then kept
  with a `WARNING kept ...` line, to delete by hand.
- `prj/package.json` and `prj/package-lock.json` are refused (exit code 1) and
  not copied: a verbatim copy would replace the generator's dependency list.

Like other synced files, the merge modifies tracked files in the
`app-generator` submodule (`package.json`, `package-lock.json`).

`lint:prj` counts the `prj:sync: merged package.json` line as a synced file; it
lints only `.ts`/`.tsx`, so `package.json` itself is not linted.

Code: `_sync_package_extra()` in `scripts/prj_sync.py`.
Tests: `code_generator/tests/test_prj_sync_package_extra.py`.
