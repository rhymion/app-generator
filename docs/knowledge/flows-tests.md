# Flow Tests (`npm run test:flows`)

`test/flows/` holds integration tests that drive generated code against a real database or a real process,
where a mocked unit test cannot prove the behavior. They run with `vitest.flows.config.ts`.

## Preconditions

`generate-code`, `db:push`, `db:generate` and `db:seed-baseline` have already run against the test database
(`npm run pretest:e2e:cy:api` does the database steps). The flows read the generated code in the working tree;
they never regenerate it.

## Serial execution

`vitest.flows.config.ts` sets `fileParallelism: false`. The flows share one database and one set of ports, and
some of them (for example the audit log operations flow of a consumer) require running one file at a time, so the
files run one after another.

## The working tree is read-only for the flows

- `cleanup.test.ts` runs `npm run cleanup:all` (`--prune-orphans`, which deletes every generated file the schema
  does not account for) on a disposable copy of the tree made under the system temp directory, and removes the
  copy afterwards. It also asserts that the working tree's file count is unchanged after the run.
- `startServer` in `helpers.ts` removes only a stale `.next/dev/lock` before starting a dev server, never the
  rest of `.next`, and it refuses to start when the port is already in use.

## Self-contained fixtures

A flow test supplies the schema features it needs and does not rely on which entities a consumer's schema
declares. `multistage_approval_rounds.test.ts` wraps the generated approvable resolver and the
`on_withdrawn` dispatcher so that its own entity name (`multistage_test_withdrawable`) counts as an approvable
that declares `x-approval.on_withdrawn`, with no side effects; any other name falls through to the generated
behavior. The same file therefore passes on this repository's sample schema and on any consumer schema.

## Consumer-owned flows

A consumer repository adds its own flows under `prj/test/flows/`. They are copied into `test/flows/` by
`prj:sync` and run by the same command. For a nullable plain string column, the generated service stores an
empty string as NULL, so such a flow reads a cleared value back as `null`.
