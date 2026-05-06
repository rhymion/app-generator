# Codex Settings

This directory mirrors the Claude Code project setup:

- `../AGENTS.md` corresponds to `../CLAUDE.md`.
- `config.toml` corresponds to the non-secret behavior in `.claude/settings.json`.
- `rules/default.rules` corresponds to the Claude `permissions.allow` command prefixes.
- `hooks/stop-sanity-check.sh` corresponds to the Claude `Stop` sanity-check hook.
- `prompts/*.md` correspond to `.claude/commands/*.md`.

Codex does not currently support repo-local custom slash commands in the same
shape as Claude Code. Use the files under `prompts/` as copyable workflow
prompts, or invoke them through shell/editor snippets.

The secret-bearing local curl command from `.claude/settings.local.json` is not
copied here. Keep machine-local secrets in environment variables or user-local
Codex config, not in repository settings.
