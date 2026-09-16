# purchase_per_item ledger ship/cancel fixtures

`service_after_approve.ts` and `service_after_reject.ts` in this directory are a
frozen snapshot of the hand-authored Ship/Cancel "GENERATED ONCE" business logic
for the `purchase_per_item` entity (OD-3 Option B, ledger_transaction strategy).

## Why fixtures instead of the working-tree file

`code_generator/generate.py` only emits a comment/TODO skeleton for this file
(`service_after_approve_stub.ts.jinja2`, `is_ship_skeleton: true` — see
`code_generator/tests/test_ship_skeleton_stub.py` for that skeleton's own test
coverage). The real Ship/Cancel Prisma logic asserted here was hand-written on
top of that skeleton once, per the "GENERATED ONCE — safe to edit" contract, and
used to live at `lib/purchase_per_item/service_after_approve.ts` /
`service_after_reject.ts` in the generated app working tree.

Those generated-app paths are gitignored (cmd_338 — generated output is not
tracked; the schema template is the source of truth) and only exist after a
`prj/` copy + `generate-code` run with a non-default schema that declares the
`inventory`/`reservation`/`purchase_per_item` entities. A pristine
`app-generator-1` checkout (no `prj/` copy, no `generate-code`) never has them,
so `code_generator/tests/test_reservation.py::TestLedgerTransactionShipAndCancelFiles`
used to fail with `FileNotFoundError` outside that non-default setup.

Since the logic itself isn't reproducible by calling the generator/template
(only the skeleton is templated — the real implementation is hand-authored),
these files pin the last known-good implementation as a tracked test fixture so
the O-4/O-6/O-8 invariants stay covered without depending on generated app
output. Content is verbatim from git history commit `05794d8` (last commit
before the file was untracked in `da48c2c`), i.e. the actual real code, not a
paraphrase — the test still checks the real Prisma statements.

If the real hand-authored implementation in a live generated app ever changes,
these fixtures should be updated to match (cmd_344).
