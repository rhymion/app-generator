#!/bin/sh
# Vercel "Ignored Build Step" for the consumer Vercel projects whose Root
# Directory is set to this submodule (app-generator/). Exit 0 = skip the
# build, non-zero = proceed (Vercel's own inverted convention). Invoked
# via a tiny stub vercel.json symlinked in at each consumer repo's root
# (vercel-ignore.json in this repo) -- see docs/knowledge/
# vercel-docs-only-ignore-command.md for why this file cannot live
# inside app-generator/vercel.json itself, and why the stub must stay
# this thin (a 256-character cap on ignoreCommand rules out inlining
# this whole script either there or in the Vercel dashboard setting).
set -u

if ! cd ..; then
  echo "cannot reach outside Root Directory -- building (fail-closed)"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "no git context outside Root Directory -- building (fail-closed)"
  exit 1
fi

BASE="$VERCEL_GIT_PREVIOUS_SHA"
if [ -z "$BASE" ] || ! git cat-file -e "$BASE" 2>/dev/null; then
  echo "no usable previous-deploy commit (new branch, or older than the shallow clone depth=10) -- building (fail-closed)"
  exit 1
fi

# Excluded-path list mirrors cmd_725's CI detect-changes job (this
# repo's own .github/workflows/ci.yml), minus the docs/consumer-commands/**
# carve-out: that carve-out exists because editing the canonical CI/gate
# templates distributed from THIS repo is a change to what every
# consumer's own CI runs, not prose about this repo -- a concern specific
# to app-generator's own CI. It doesn't apply here: this diff is always
# evaluated against a CONSUMER repo's own root (after cd ..), which has
# no docs/consumer-commands/ directory of its own.
if git diff --quiet "$BASE" HEAD -- . \
    ':(exclude)docs/**' \
    ':(exclude)README.md' ':(exclude)README_ja.md' \
    ':(exclude)CHANGELOG.md' ':(exclude)AGENTS.md' ':(exclude)CLAUDE.md' \
    ':(exclude)LICENSE'; then
  echo "docs-only diff ($BASE..HEAD) -- skipping build"
  exit 0
else
  echo "non-docs diff ($BASE..HEAD) -- building"
  exit 1
fi
