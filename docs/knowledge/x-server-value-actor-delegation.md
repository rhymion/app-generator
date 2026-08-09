# `x-server-value`: Server-Computed Field Values With Optional Delegation

## The problem it solves

`creator_id` is written by the server unconditionally — `build_context.py`'s `_EXCLUDE_ID_TS`
strips it from every client-writable parameter, and `service.ts.jinja2` hardcodes
`creator_id: actorId,` on every create. A client can never supply or override it. That covers
"who created this row" for every entity, but it doesn't cover a *domain* field that should carry
the acting user's id under the same guarantee — e.g. "who is this leave request for" — because
`creator_id` is a fixed audit column, not a field a schema author can point at a domain concept
("applicant", "requester") or reuse for a second user reference on the same entity.

Before this mechanism, a schema author had two bad options for such a field: declare it as a
plain FK (client-writable, no protection at all) or reach for `x-readonly` (which has no way to
express "but supply it from context on create" — it only knows "never editable").

## What it declares

```yaml
applicant_id:
  type: string
  pattern: "^c[a-z0-9]{24,}$"
  x-relationship:
    type: many-to-one
    target: user
    labelField: name
  x-server-value: "actor"          # string form — see below
```

or, to allow a permitted actor to act on someone else's behalf:

```yaml
applicant_id:
  type: string
  pattern: "^c[a-z0-9]{24,}$"
  x-relationship:
    type: many-to-one
    target: user
    labelField: name
  x-server-value:
    source: actor
    override_permission: delete    # dict form
```

`x-server-value` implies readonly automatically — no separate `x-readonly: true` needed. The
field is excluded from every form input (create and edit), protected by the existing PUT AP-3=B
reject, and excluded from the UPDATE `SET` clause, exactly like any other readonly field.

## Two forms, two different guarantees

### String form: `"actor"`

The field always gets the authenticated actor's id. Any value a client submits for it — via the
REST API body or a server action's `FormData` — is discarded entirely; the field isn't even a
service parameter (`build_context.py` excludes it from `parent_prop_infos`). This is the original
(cmd_556) design: **"receive nothing, decide server-side, write actorId."**

### Dict form: `{source: actor, override_permission: <Operation>}`

Same default behavior, but an actor holding `override_permission` (one of `lib/authz.ts`'s
`Operation` values — `create` | `read` | `update` | `delete` | `import`) may supply an explicit
value that is honored as-is. This is the cmd_565 delegation revision, motivated by the case
where an admin needs to file a leave request *for* someone else, not only for themselves.

The three behaviors this produces on **create**:

| Actor sends... | Actor has `override_permission`? | Result |
|---|---|---|
| nothing | — | actorId (α — self-apply, the default) |
| an explicit value | yes | that value, as-is (β — authorized delegation) |
| an explicit value | no | actorId — **not a rejection** (γ — silent substitution) |

γ is deliberately not an error: the request's actual purpose (create a leave request) still
succeeds, just attributed to the real actor rather than the identity they tried to claim.
Rejecting the whole request over an unauthorized `applicant_id` guess would be worse UX than
just continuing as the real actor — this field is not the same kind of "read-only" as e.g. a
locked status column, where any attempted write is a mistake worth surfacing as an error (see
[[cmd-565-readonly-create-guard]] below for that other case).

### Why `override_permission` reuses `Operation` instead of a new permission kind

`lib/authz.ts` has no "manage" or "delegate" permission — only the five CRUD-shaped `Operation`
values already seeded per role. Introducing a sixth kind would mean new DB rows, a new UI setting,
and a new code path with no existing precedent. `delete` is the natural default to declare:
across this generator's default entities, "can delete" already tracks "is trusted to act on
behalf of others" more closely than `create`/`update` (which are often granted broadly). A schema
author can declare any of the five — the choice is theirs, not fixed by the generator.

### `_server_value_overrides`: don't discard silently

γ still writes a value the client didn't ask for. Per the "don't silently discard" precedent
(cmd_530), the REST create response carries an optional flag:

```json
{ "id": "...", "_server_value_overrides": { "applicant_id": "overridden" } }
```

present only when an override-capable field's submitted value didn't survive (γ). It's absent
entirely on α (nothing was overridden — there was nothing to honor or discard) and on β (the
value *was* honored, not overridden). A caller — a script, an integration, an admin UI — can
detect "my explicit choice didn't take effect" without guessing from a 200 status alone.

Server Action callers don't get an equivalent notification yet — the return value threading and
UI toast wiring is a separate, broader change (form actions typically end in `redirect()`, with
no existing channel back to the browser for a "by the way" note), deferred to a future cmd. Where
`x-audit` is enabled, the audit log's own `creator_id` + snapshotted fields let anyone reconstruct
what happened after the fact — a partial mitigation until the Server Action side is built out.

## Worked example: `leave_request.applicant_id`

This is a genuinely useful *product* pattern (self-service leave requests an admin can also file
on a subordinate's behalf), but `leave_request` is a **consumer-domain entity** — it is not, and
must not become, part of this generator's own shipped `code_generator/json_schema.yaml`. See
[[default-vs-consumer-entity-boundary]]: `leave_request` is exactly the kind of entity name that
doc already lists as a consumer's own domain concept, previously and deliberately removed from
this repo's shipped artifacts (cmd_478, cmd_488). The declaration above is illustrative — a
consuming project's own `prj/code_generator/json_schema.yaml` is where it would actually live.
`code_generator/tests/test_server_value_fields.py` uses the same example as an in-process pytest
fixture (never a shipped schema entity), matching that doc's explicit allowance for domain names
in unit test fixtures.

## Generated UI test scaffold must not fill a field that isn't rendered

The worked example above was carried through to a real consuming project's schema, which surfaced
a gap this doc's original design didn't cover: `spec_context()` (drives the generated *UI* test —
`test_spec.cy.ts.jinja2`, not the API test) had two code paths that were unaware of
`x-server-value` and still generated a `cy.selectAutocomplete()` call against the field:

1. `req_ua_spec`/`all_ua_spec` (create and fail-edit fill commands, and their matching
   `cy.checkField()` assertions) — every FK targeting `user` (except `creator_id`/`updater_id`)
   was included regardless of `x-server-value`.
2. `edit_primary_cmd` (the 3.3 "edits with mixed changes" test) — when the field is *also* the
   entity's `x-display.table` primary column (exactly `leave_request.user_id`'s shape), a separate
   code path generated the same kind of command.

Since `x-server-value` fields are always excluded from every form input (create and edit — see
above), the form never renders an autocomplete for them, and the generated test failed outright:
`Expected to find element: 'filter', but never found it` (`getAutocompleteInput()` can't locate a
filter box for an input that doesn't exist). Both code paths now check a locally-computed
`x-server-value` prop-name set and skip the field entirely — `req_ua_spec`/`all_ua_spec` omit it
from their entries, and `edit_primary_cmd` becomes `None` (the 3.3 test still edits whatever other
field it was already touching) with `populate_count_3_3` dropping back to `1` (the 2-row
FK-switch setup that field's autocomplete would have needed is moot once it's never edited through
the UI). The API-level test scaffold was never affected — it supplies the value directly as a
request body field, a wholly separate code path from this UI form-fill generator.

**Not yet resolved**: fixing these two paths surfaced (rather than caused) a handful of deeper,
narrower UI-level issues in the same consuming project's generated spec — a "3.3 edits with mixed
changes" test redirecting to an unrelated entity's view page after save, and two approval-flow
tests asserting stale display-name content (`'Test User'`) that no longer matches once `user_id`
is actor-attributed rather than a fixed dependency fixture. These are flagged as follow-up work,
not yet root-caused.

<a name="cmd-565-readonly-create-guard"></a>
## Related, but separate: the CREATE-time read-only guard

`x-server-value` fields are automatically readonly, but *plain* `x-readonly` / `x-readonly-fields`
fields (no `x-server-value` involved) have their own, stricter rule on create: PUT's AP-3=B
compares a submitted value against the *persisted* row and rejects a mismatch — but CREATE has no
persisted row to compare against, so before cmd_565 a plain read-only field's client-submitted
value on create flowed straight into the database, unguarded, via both the REST route and the
create+update server action. Both now hard-reject any client-submitted value for such a field on
create (`400` / thrown error respectively) — there is no legitimate value to fall back to the way
`x-server-value` has actorId, so the only sound response is to refuse the write outright, not
silently drop it. `x-server-value` fields are exempted from this generic reject — they already
have their own dedicated, more nuanced resolution above.

## Extension point

Only `source: actor` is implemented. A future `source: org` (the acting user's organization) or
`source: now` (a server timestamp) would extend the same dict shape and the same
`server_value_fields` dispatch in `build_context.py` — the schema vocabulary doesn't change, only
the set of recognized `source` values. `validate.py` rejects any other `source` today so a typo or
an aspirational-but-unimplemented value fails at generate-code time instead of silently no-opping
(the field would otherwise just behave like an ordinary client-writable FK, with no readonly
protection at all — worse than doing nothing, since the schema *reads* as protected).

## Forward-compatibility note

A future "same model, separate entity/screen for admins" UI has been flagged as a possible
follow-up (letting an admin pick an applicant through a dedicated admin-facing form rather than
the self-service one). Nothing in this mechanism assumes a particular UI — `override_permission`
is checked purely server-side (REST body / server action `FormData`), so whatever UI eventually
collects the override value is free to be built independently, later.
