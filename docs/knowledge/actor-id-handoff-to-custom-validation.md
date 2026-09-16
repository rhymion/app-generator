# Handing `actorId` to `validateCustomRules()`

## Problem

`lib/{entity}/service_validation_custom.ts` (the write-once custom-validation
socket) could see `data` and the pre-edit row (`prevRow`) — but not *who*
is performing the write. A hand-written rule that needs to stamp a
system-owned row as a side effect of this write (e.g. an
`inventory_transaction` ledger entry, whose `created_by_id`/`updater_id`
columns are required, non-nullable FKs to `user`) had no way to do that from
inside the hook — it would have to duplicate the caller's own actor
resolution, which the hook has no access to.

Found while implementing a Proxy View entity that needs to write an
inventory ledger row from inside `validateCustomRules()`, which requires an
actor id.

## The mechanism

Same shape as the existing `prevRow` handoff (see
`pre-edit-row-handoff-to-custom-validation.md` for the full backward-compat
mechanism this reuses) — a 5th parameter on `validateCustomRules`, threaded
through `validateSchemaRules`/`validateOnAdd`/`validateOnUpdate`, added via
the same `CustomRulesFn` structural-widening cast so every already-generated
3- or 4-parameter hand-written stub keeps compiling unmodified (a function
that doesn't declare a 5th parameter simply never binds it — JavaScript
silently discards a call's trailing arguments the callee doesn't declare).

One difference from `prevRow`: **`actorId` is never `null`.**
`add{Parent}(actorId: string, ...)` and `update{Parent}(actorId: string, id:
string, ...)` both already declare `actorId` as a required `string` —
resolved from the NextAuth session cookie on the Server Action path
(`getSessionUserIdOrThrow()` in `actions.ts`) and from the API key's owning
user on the REST path (`authenticateApiKey()` in `lib/api-auth.ts`, called
directly by `api_route.ts`/`api_detail_route.ts` — not the session-only
`resolveActorId()`/`requireDualAuth()` helpers). Both throw before reaching
`add{Parent}`/`update{Parent}` if no caller can be resolved, so by the time
either function's body runs, `actorId` is already a real user id. `prevRow`
needed `| null` because create has no previous row; `actorId` needs no such
branch — every entry point that calls `validateOnAdd`/`validateOnUpdate`
already has one. `CustomRulesFn`'s 5th parameter is therefore typed as
`actorId: string`, not `string | null`.

```ts
// service_validation.ts.jinja2 — call site
await (validateCustomRules as CustomRulesFn)(tx, data, currentId, prevRow, actorId);
```

```ts
// service.ts.jinja2 — both call sites already had actorId in scope
await validateOnAdd(tx, { ...data }, actorId);
await validateOnUpdate(tx, id, { ...data }, _prevRow, actorId);
```

### REST PUT/POST already resolves a real actorId — no new auth mechanism

The original concern was that the REST path, authenticated by API key
rather than a session cookie, might have no resolvable actor. That turned
out not to be the case: `api_route.ts.jinja2` and `api_detail_route.ts.jinja2`
already call `authenticateApiKey(request)` directly and bind its result to
`actorId` before calling `add{Parent}`/`update{Parent}` — the same variable
name, the same required `string` type, already used for
`requireApiPermission`, org-scoping, audit events, etc. on that path. There
is no session-vs-API-key gap to close here; this change only forwards a
value that was already being resolved and already in scope at both call
sites.

### Verified empirically

- `next build` (as part of the full build gate) compiles this repo's two
  tracked write-once `service_validation_custom.ts` stubs
  (`lib/approval_flow/service_validation_custom.ts`,
  `lib/dashboard/service_validation_custom.ts`) unmodified against the new
  5-parameter `CustomRulesFn` cast — both still declare their pre-existing
  signature (3 or 4 parameters) and were not touched by GENERATED-ONCE.
- The mandatory API e2e gate: 239/239 passing, 0 skipped.
- The full UI e2e gate: see the PR for the run's pass/skip counts.

## Files touched

- `code_generator/templates/service_validation.ts.jinja2` — `CustomRulesFn`
  gains `actorId: string`; `validateSchemaRules`/`validateOnAdd`/
  `validateOnUpdate` all take and forward it.
- `code_generator/templates/service.ts.jinja2` — `validateOnAdd`/
  `validateOnUpdate` call sites pass the already-in-scope `actorId`.
- `code_generator/templates/service_validation_custom_stub.ts.jinja2` — new
  stub's `validateCustomRules` signature gains `actorId` (5th parameter).

## Not in scope here

- What a specific ledger-write hand-written rule does with `actorId` once
  it has it — that belongs to the entity implementing it, not to this
  generator-mechanism change.
- A UI-side bridge, a schema-declared actor-scoped rule, or any new
  authentication mechanism — none of those were needed; see "REST PUT/POST
  already resolves a real actorId" above.
