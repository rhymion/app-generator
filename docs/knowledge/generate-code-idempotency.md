# generate-code must not read its own prior output

**Rule**: `code_generator/generate.py` must derive everything it needs to
emit correct code from the schema (and, for a file-wins overlay, from
values a *consumer* has explicitly customized) — never from a file that an
earlier `generate-code` run itself wrote as output. If a generator step
reads its own previous output to decide what to emit next, running it twice
against an unchanged schema is not guaranteed to produce the same result
twice, and a project bootstrapping for the first time (before that output
file exists or is complete) can diverge from every run after it.

## The defect

Cypress spec generation needs to know the *displayed* label for enum
values (e.g. the nativeEnum member `pie` renders as `Pie` in the UI) so
generated specs interact with the app using the same text a user would
see. `generate()` used to get that mapping by loading `messages/en.json`
directly:

```python
_msg_path = out / 'messages' / 'en.json'
if _msg_path.exists():
    with open(_msg_path) as _mf:
        _all_messages = _json.load(_mf)
    set_messages_fields(_all_messages.get('Fields', {}))
    set_messages_namespaces(_all_messages)
```

`messages/en.json` is not an input — it is written by the same `generate()`
call, later, by `generators_i18n.update_i18n_and_config()`. That function
only *adds* missing keys (`_update_json`'s merge rule: `if key not in
data[section]`) and never creates a `messages/*.json` file that doesn't
already exist (it iterates `messages_dir.glob('*.json')`, so a missing file
is silently skipped, not created). The result: on a project's first-ever
`generate-code` run, or any time a translation section is genuinely
missing, spec generation ran before that section existed for the run that
needed it, so `_messages_fields` / `_messages_ns` were empty — the enum
label lookup fell back to the *raw* enum value (`'pie'`) instead of the
humanized display label (`'Pie'`). The app itself renders the humanized
label regardless (its own i18n lookup goes through the file written at the
end of that same `generate()` call), so the generated spec and the
running app disagreed, and Cypress failed with:

```
AssertionError: Timed out retrying after 10000ms: Expected to find
content: 'pie' within the element: <li.MuiMenuItem-root> but never did.
```

Re-running `generate-code` a second time (now that the file has the
correct humanized values) produced a *different*, correct spec — the
generator was not idempotent: run 1 and run 2 against the same,
unchanged schema produced different output.

## The fix

`generate()` now computes the schema-derived label defaults itself, using
the same collectors `update_i18n_and_config` already uses
(`_collect_field_keys`, `_collect_native_enum_namespaces`,
`_collect_custom_component_sections`), and only *overlays* any existing
`messages/en.json` values on top — file values win, via
`generators_i18n._merge_file_wins_messages()`, matching `_update_json`'s own
merge rule (existing keys preserved, missing keys filled from the schema).
This satisfies both properties at once:

- **Idempotency**: run 1 (no file yet, or a section missing) uses the
  schema defaults. `update_i18n_and_config` then writes those same schema
  defaults into the file. Run 2 (file now present) merges the file's
  values — which are the schema defaults — back on top of the schema
  defaults, producing an identical result.
- **Consumer-translation compatibility**: if a consumer hand-edits
  `messages/en.json` (e.g. `pie: 'Custom Pie Chart'`), that value wins the
  overlay and appears in the spec too, since it is the same value the app
  will render.

`generators_test.py`'s enum-label lookups (`_enum_label`,
`_reverse_enum_label`) were also made fail-fast instead of silently
degrading to a raw/ambiguous value: a declared namespace section with a
missing key, a reverse-lookup with no matching member, or a reverse-lookup
where two members humanize to the same label now all raise `ValueError`
rather than producing a silently-wrong spec. A wholly absent namespace
section only warns (not an error) — `generate()`'s overlay guarantees the
section always exists once schema and file are merged, so an absent
section only happens when calling these functions directly outside
`generate()`.

## Rule of thumb for future generator changes

Before wiring a generator step to read any file under `output_dir`, ask:
*did an earlier step in this same `generate()` call (or a prior run of it)
write that file?* If yes, that step is reading its own output, not an
input — replace the read with the same schema-derived computation the
writing step uses, and treat the file only as an optional consumer-wins
overlay if human customization needs to survive regeneration.

## Verification

`code_generator/tests/test_spec_enum_label_idempotency.py` covers the
merge (`_merge_file_wins_messages`) and both lookup functions via
dependency injection (`set_messages_fields` / `set_messages_namespaces`) —
no generated artifacts required. Additionally verified against real
generated output (fresh `git worktree`, isolated Docker/DB per this repo's
worktree-isolation conventions):

- Two consecutive `generate-code` runs against an unchanged schema produce
  byte-identical Cypress spec files (`sha256sum` over `cypress/e2e/**/*.cy.ts`).
- A hand-edited `messages/en.json` translation propagates into the
  generated spec and remains stable (byte-identical) across further runs.
- With the pre-fix code and a `messages/en.json` missing the relevant
  enum-label sections (simulating first-run bootstrap), the generated
  `dashboard.cy.ts` spec failed against the real running app
  (`Expected to find content: 'pie' ... but never did`); with the fix
  applied and the identical bootstrap state, the same spec passed.
