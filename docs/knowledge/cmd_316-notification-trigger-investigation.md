# Notification Feature: Current Behavior Investigation (cmd_316)

Read-only investigation. No code, schema, or test changes were made while producing this report.

## 1. Architecture overview

The notification feature was introduced in commit `465a78f` ("feat: In-app notifications via
in-memory inbox + SSE bell", 2026-05-11) on the `app-generator` submodule, described in that
commit as "A starter notification feature for proj_b" (this generator repo is consumed by
proj_c as a submodule — see project topology memory).

**Storage — `lib/_notifier.ts`** (hand-written, not code-generated; `lib/_notifier.ts:1-131`):
- In-process `Map<userId, Notification[]>` (`lib/_notifier.ts:48`), capped at 50 entries/user
  (`INBOX_CAP`, `lib/_notifier.ts:45`) with a 7-day TTL sweep (`lib/_notifier.ts:46,52-55`).
- `notify(userId, type, payload)` (`lib/_notifier.ts:57-78`) appends to the map and emits on a
  module-level `EventEmitter` (`lib/_notifier.ts:49,76`).
- `subscribe(userId, handler)` (`lib/_notifier.ts:88-99`) is used by the SSE route.
- **No database table.** There is no `notification` model anywhere in
  `prj/code_generator/json_schema.yaml` or the generated Prisma schema — confirmed by
  `grep -rn "notification" prj/code_generator/json_schema.yaml` returning zero hits. Storage
  is purely the in-memory `Map`, which means: notifications are lost on server restart, and are
  **not shared across multiple server processes/instances** (module-level singleton per Node
  process). This is an explicit, documented trade-off (`lib/_notifier.ts:14-18`), not a bug, but
  it is a relevant caveat for any cloud/serverless deployment with >1 instance.

**Delivery — `app/api/notifications/*`** (hand-written):
- `GET /api/notifications` (`app/api/notifications/route.ts:12-21`): returns
  `listNotifications(userId)` + `unreadCount(userId)`.
- `POST /api/notifications/mark-read` (`app/api/notifications/mark-read/route.ts:12-19`): calls
  `markAllRead(userId)`.
- `GET /api/notifications/stream` (`app/api/notifications/stream/route.ts:40-95`): SSE endpoint,
  `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` (lines 31-32). Sends a `snapshot` event on
  connect (lines 62-65) then one `notification` event per `notify()` call via `subscribe()`
  (lines 67-69), with a 25s keepalive (lines 71-73, `KEEPALIVE_MS` line 34).

**UI — `components/_standard/NotificationBell.tsx`** (hand-written): mounted in the app header at
`app/[locale]/@header/page.tsx:9` (import) and `:97` (`<NotificationBell />`) — confirmed via
`grep -rn "NotificationBell"` across the repo (excluding its own definition/test files), so the
bell **is** wired into the live layout, not orphaned.

**Generated vs hand-written**: `lib/_notifier.ts`, `lib/_notifyApprovalRequest.ts`, the three
`app/api/notifications/*` routes, and `NotificationBell.tsx` are all hand-written infrastructure
(no jinja2 template exists for any of them — confirmed via `find code_generator/templates -iname
"*notif*"` returning nothing). What **is** code-generated are the four *call sites* that invoke
`notify()`/`notifyApprovalRequestCreated()` from entity-specific generated code — see triggers
below. Only those call sites can vary per-entity/per-project; the storage/delivery/UI layer is
fixed hand-written plumbing that every entity shares.

### The "notification design 2026-05-11" citation is a dangling reference

Several code comments cite "notification design 2026-05-11" or `performance-plan-session.md`
(`lib/_notifier.ts:20`, `code_generator/build_context.py:389,447`,
`code_generator/templates/service.ts.jinja2:58`), implying a design doc exists. It does not, in
this repo or anywhere findable:
- `find . -iname "performance-plan-session*"` inside `app-template` (parent + submodule):
  no hits.
- The only file with that name on disk is
  `~/work/tutorial/app-generator-1/memory/performance-plan-session.md`, which belongs to a
  **different, unrelated project** (proj_a) and is dated 2026-05-04. It never mentions
  "notification" (`grep -i notif` on that file returns zero matches). This is a coincidental
  filename collision, not the cited doc.
- The actual specification of the four triggers only exists in the body of commit `465a78f`
  (`git log -1 --format=%B 465a78f`), reproduced in full below — no persisted design doc exists
  for this feature in either `docs/knowledge/`, `docs/`, or the `planning/` directory
  (`~/work/app-generator-project-docs/planning/`, which has no notification-related file).

Full trigger list as originally specified in commit `465a78f`:

1. **Item assigned** — generator: `service.ts.jinja2` emits `notify()` in `addXxx` (when
   `assigneeId` is set) and in `updateXxx` (only when `assigneeId` actually changes vs. the
   previous row). Self-assign is skipped.
2. **Approval request created** — `lib/_notifyApprovalRequest.ts`: given a new
   `approval_request` id, fetches the flow's `approver_role`, the users in that role, and
   (when supplied) filters by `orgId`. Originally called from
   `lib/leave_request/service_after_create.ts`.
3. **Approval request approved/rejected** — `lib/approval_request/actions.ts` resolves the
   entity creator via the `approvable` bridge and notifies them with the outcome.
4. **Comment created** — `build_context.py`: `_build_comment_actions` /
   `_build_comment_actions_bridge` emit a `notify()` call to the parent's creator (and assignee,
   if `has_assignee_id`). The comment author is never self-notified.

The Lord's recollection of "2 triggers" (approval-authority notification on approval-request
creation, and self-assignment notification, both excluding self-action) maps to design triggers
**#2** and **#1** respectively. Triggers #3 and #4 are additional triggers the Lord did not
mention — investigated below for completeness (§4).

## 2. Trigger 1 — self-assignment → notify new assignee (Lord's intended trigger, design's #1)

**Template implementation** (`code_generator/templates/service.ts.jinja2`):
- `addXxx` path, lines 57-68: guarded by `{% if has_assignee_id %}`. Fires
  `notify(assigneeId, 'assigned', {...})` at line 61, gated by
  `if (assigneeId && assigneeId !== actorId)` (line 60) — correctly excludes self-assignment.
- `updateXxx` path, lines 87-94 capture `_prevAssigneeId` before the update; lines 122-130 (the
  `{% if has_assignee_id %}` block after the transaction) fire `notify()` only when
  `assigneeId && assigneeId !== _prevAssigneeId && assigneeId !== actorId` (line 123) — correctly
  fires only on an actual assignee change, and still excludes self-assignment.
- The `notify` import itself is conditionally injected only when `has_assignee_id` is true:
  `code_generator/generators.py:1985`
  (`f"\nimport {{ notify }} from '@/lib/_notifier';" if has_assignee_id else ''`).

**This logic is correctly implemented and generic** — it is not the bug. Verified live in
generated code: `grep -rln "from '@/lib/_notifier'" lib/*/service.ts` and
`grep -rln "notify(" lib/*/service.ts` both return exactly one file:
`lib/procedure/service.ts` (`lib/procedure/service.ts:5,74-79,122-127`).

**Root cause of "no notification observed": only one entity in the whole schema has
`assignee_id`.** `grep -n "assignee_id" prj/code_generator/json_schema.yaml` returns a single
hit, at `prj/code_generator/json_schema.yaml:1315`, under the `procedure` entity definition
(entity block starts at line 1288). No other entity in the project's schema — not
`leave_request`, `purchase_order`, `db_table`, etc. — declares an `assignee_id` field. If the
Lord tested self-assignment on any entity other than `procedure`, the assignment-notification
code path is never even generated for that entity (no `has_assignee_id` ⇒ template emits nothing,
no import, no call). This is not a delivery/logic bug for Trigger 1; it is a **schema coverage
gap** — the assignee concept, and therefore this notification trigger, only exists on one
niche/administrative entity.

## 3. Trigger 2 — approval request created → notify approvers (Lord's intended trigger, design's #2)

**`lib/_notifyApprovalRequest.ts:43-81`** (`notifyApprovalRequestCreated`) is well-formed and
correctly designed:
- Looks up the `approval_flow.approver_role_id` for the given `approval_request` (lines 49-58).
- Loads all users holding that role plus their `organizations` (lines 60-63).
- Iterates recipients, skipping `excludeUserId` (the creator — line 72) and, when `orgId` is
  supplied, filtering to that org (line 73) — i.e. self-exclusion and org-scoping are both
  present and correct.
- Fires `notify(u.id, 'approval_requested', {...})` per recipient (lines 74-79).

**However, this function currently has zero callers anywhere in the repository.**
`grep -rn "notifyApprovalRequestCreated" --include="*.ts" --include="*.tsx" .` (excluding
`node_modules`/`.next`) returns only its own definition
(`lib/_notifyApprovalRequest.ts:43`) — no call site.

**Where the call site used to be, and how it was lost:**
- At introduction (`git show 465a78f:lib/leave_request/service_after_create.ts`), this
  write-once file *did* import and call it: `import { notifyApprovalRequestCreated } from
  '@/lib/_notifyApprovalRequest';` and, after creating the `approval_request` rows, a loop
  calling `notifyApprovalRequestCreated(db, reqId, { approvableId, entityLabel: 'Leave Request',
  orgId, excludeUserId: creatorId ?? null })`, explicitly commented "Trigger #2 (notification
  design 2026-05-11)".
- The **current** `lib/leave_request/service_after_create.ts` (verified on disk, matches the last
  git-tracked version at commit `54eebd3`) creates the `approval_request` rows
  (lines 25-42 of the current file) but has **no import of, and no call to,
  `notifyApprovalRequestCreated`** — confirmed by `diff`-ing the file against
  `git show 54eebd3:lib/leave_request/service_after_create.ts` (identical, zero diff) and
  by direct read.
- `lib/leave_request/service_after_create.ts` is a **generator write-once stub**
  (`code_generator/generate.py:407-413`, `_write_stub(...service_after_create_stub.ts.jinja2...)`;
  documented in `code_generator/cleanup.py:10-13` and `:60-70`) — the generator only writes this
  file if it does not already exist, and cleanup only deletes it when its content matches the
  boilerplate exactly, otherwise it's preserved as customized. This means the notify() call could
  only have disappeared if the file itself was deleted at some point and then regenerated fresh
  from the template — which does not contain the call.
- **Confirmed via `git log --all --follow -- lib/leave_request/service_after_create.ts`**: the
  chain of commits touching this path includes `a68ebdc "fix(generator): generate
  approval_request creation in afterCreate for approval-flow entities"` and two follow-up commits
  `6d02445`/`6ca27fd "fix(generator): restore approvable approval-flow in
  service_after_create_stub"`, whose message states: *"Restore approvable conditional branch lost
  in a68ebdc (doreen/analytics, 2026-06-02) main-merge regression. Template-only fix;
  generate.py unchanged."* — i.e. a merge regression on 2026-06-02 dropped the approval-flow
  branch from the **generator template**
  `code_generator/templates/service_after_create_stub.ts.jinja2`, and the later fix restored the
  `approval_request`-creation logic into that template, but **did not restore the
  `notifyApprovalRequestCreated` call**, because that call was never part of the template in the
  first place — it only ever existed as a one-off hand-edit to the generated *output* file in
  commit `465a78f`. Once the output file was wiped and regenerated from the template (which was
  itself being repaired around the same period), the hand-edit was permanently lost.
- **Confirmed the template itself has no notification logic at all**:
  `grep -n -i "notify\|approval_request\|approvable"
  code_generator/templates/service_after_create_stub.ts.jinja2` shows the `approvable`/
  `approval_request.create` logic (lines 1, 11-12, 35, 37, 46-47) but zero occurrences of
  `notify`.

**Root cause (definitive): the generator template `service_after_create_stub.ts.jinja2` was
never updated to include the `notifyApprovalRequestCreated()` call that trigger #2 requires.**
The call only ever existed as a manual edit to one generated file for one entity
(`leave_request`), and was silently dropped the first time that file was regenerated from the
(notify-less) template after a merge regression. Because `notifyApprovalRequestCreated` is
unreferenced by any code path today, **no approval-request-creation notification can fire for
any entity in this project, or in any other project that regenerates this stub from the current
template** — this is a generator-level defect, not project-local.

## 4. Other triggers (not requested by the Lord, checked for completeness)

- **Trigger #3 (approval approved/rejected → notify creator)**: implemented in
  `lib/approval_request/actions.ts` (hand-written, generic — not per-entity). Imports `notify`
  at line 6; calls `notify(recipientId, 'approval_responded', {...})` at lines 116 and 187, where
  `recipientId` is resolved from `approvable.creator_id` (lines 23, 27, 51, 58). This is generic
  across all `approval_flow`-enabled entities (operates on the shared `approval_request`/
  `approvable` tables directly, not per-entity generated code), so it does not suffer from the
  same "write-once stub regenerated without the call" failure mode as trigger #2. This trigger
  appears functional, though it was not independently exercised in this investigation (read-only
  scope; no runtime testing performed).
- **Trigger #4 (comment created → notify creator + assignee)**: implemented generically in
  `code_generator/build_context.py:_build_comment_actions` (lines 382-406) and its bridge
  counterpart, both explicitly excluding the commenter (`filter(id => id !== userId)`, line 399).
  Verified live in generated code: `lib/db_table/actions.ts:7,59,70` (`addDbTableComment`)
  imports and calls `notify()` correctly. This trigger is generic (keyed off `comment_children`
  in the schema, not a per-entity hand-written call site) and appears functional.

## 5. Discrepancy table

| Intended trigger (Lord's memory) | Design # | Implementation status | Fires? | Root cause if not firing | Impact |
|---|---|---|---|---|---|
| Approval request created → notify users with approval authority, excluding self | #2 | `notifyApprovalRequestCreated()` exists and is correctly written (`lib/_notifyApprovalRequest.ts:43-81`), but has **zero call sites** anywhere in the repo | **No** | The one call site (`lib/leave_request/service_after_create.ts`, added by hand in `465a78f`) was lost when the write-once stub was regenerated from `service_after_create_stub.ts.jinja2` after a 2026-06-02 merge regression (`a68ebdc`) and its subsequent template-only fix (`6ca27fd`/`6d02445`), neither of which restored the notify call. The generator template never contained this call. | No user is ever notified of a new approval request, for any entity, in this project or any project regenerating this stub |
| Self-assignment → notify new assignee, excluding self-assign | #1 | Correctly templated and generic in `service.ts.jinja2:57-68,122-130`; conditional `notify` import at `generators.py:1985` | **Only for `procedure`** | Only `procedure` (`prj/code_generator/json_schema.yaml:1315`) declares `assignee_id` in the entire schema — every other entity has no assignee concept, so the trigger's code is never generated for them | Assignment notifications work correctly, but only cover one niche entity; testing on any other entity will show no notification and looks like "not implemented" even though the mechanism is sound |
| *(not recalled by Lord)* Approval approved/rejected → notify entity creator | #3 | Implemented, generic, hand-written (`lib/approval_request/actions.ts:6,116,187`) | Likely yes (not runtime-verified in this read-only investigation) | N/A | — |
| *(not recalled by Lord)* Comment created → notify creator + assignee, excluding commenter | #4 | Implemented, generic, code-generated (`build_context.py:_build_comment_actions`); verified live in `lib/db_table/actions.ts` | Likely yes (not runtime-verified) | N/A | — |

## 6. Recommendations (not implemented — investigation only)

**Fix for Trigger 2** (generator-level, affects every project consuming this generator):
- Add the `notifyApprovalRequestCreated(...)` call into
  `code_generator/templates/service_after_create_stub.ts.jinja2` itself, inside the
  `{% if one_to_one_rels | selectattr('target', 'equalto', 'approvable') | list %}` branch,
  immediately after the `approval_request.create` loop (mirroring what `465a78f` hand-added to
  the output, i.e. call `notifyApprovalRequestCreated(db, reqId, { approvableId: approvable.id,
  entityLabel: <derived label>, orgId: <if entity has org scope>, excludeUserId: creatorId ??
  null })` for each created `approval_request`). Because this file is write-once, existing
  per-project customized copies (if any project has since hand-edited theirs) would need the
  call added manually too, or the project would need to delete the stale stub and let it
  regenerate — flag this in the fix's commit message so downstream consumers know to check.
- Import `notifyApprovalRequestCreated` conditionally in the template, gated the same way
  `has_assignee_id` gates the `notify` import in `service.ts.jinja2` (i.e. gated on "entity
  participates in an approval flow", mirroring the existing `one_to_one_rels ... approvable`
  check already used in this template).

**Fix for Trigger 1's coverage gap**: this is a schema/design decision, not a code bug — either
accept that only `procedure` supports assignment notifications, or add `assignee_id` (with
`x-relationship`) to whichever entities should support it, following the same pattern as
`prj/code_generator/json_schema.yaml:1315-1320`.

**Test plan** (SKIP = FAIL; all three levels currently have zero coverage of trigger 2, which is
exactly how this regression went unnoticed by the mandatory gate):
- **Unit** (`lib/_notifier.test.ts` or a new `lib/_notifyApprovalRequest.test.ts`): assert
  `notifyApprovalRequestCreated` populates the right users' inboxes given a mocked `tx`
  (role members, org filter, self-exclusion) — this already exists for the low-level store but
  not for this function specifically; `grep -n "^describe\|^  it(" lib/_notifier.test.ts` shows
  only `notify`/`listNotifications`/`unreadCount`/`markAllRead`/`clearInbox`/`subscribe`/TTL
  coverage, nothing for `_notifyApprovalRequest.ts`.
- **API e2e** (`test:e2e:cy:api`, the mandatory gate): `grep -rln -i "notif"
  prj/cypress/e2e/api/` and the equivalent under `app-generator/cypress/e2e/` both return zero
  files — there is currently no API e2e coverage of any notification trigger. Add a real
  assertion-based test (not a skip) that creates a `leave_request` (or whichever
  approval-flow-enabled entity), then calls `GET /api/notifications` as the approver user and
  asserts the new `approval_requested` notification is present with the right `href`/title, and
  that the requesting user's own `GET /api/notifications` does NOT contain it (self-exclusion).
  Because this is the exact trigger that regressed silently once already, this test belongs in
  the mandatory gate, not an optional UI suite.
- **UI e2e**: a supplementary spec asserting the bell badge count increments and the dropdown
  shows the new item after the same flow, using the existing SSE `snapshot` event (no polling
  needed) — optional per project convention, but recommended given the bell is user-facing.
