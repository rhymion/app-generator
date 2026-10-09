# Mobile App (Expo)

`generate-code` also renders an Expo (React Native) project into `mobile/`. Its navigation is built from
the **same source as the desktop sidebar** — `x-nav` on entities and `x-nav-groups` at the top level,
resolved by `code_generator/nav_config.py` — so a schema needs no mobile-specific key. `mobile/` is
generated output: it is git-ignored, except for the hand-written Playwright files in `mobile/e2e/`,
`mobile/playwright.config.ts` and `mobile/scripts/`.

This is not the responsive web layout described in
[mobile-responsive-layout.md](mobile-responsive-layout.md); that document covers the Next.js app at a
narrow viewport.

## Navigation

`code_generator/mobile_nav.py` turns `build_nav_config()` and `nav_list_entities()` into the tree the app
embeds in `mobile/lib/nav.ts`. It mirrors `lib/nav-tree.ts` `buildRootTree`.

| Desktop sidebar | Mobile |
|---|---|
| Flat (ungrouped) entity links, in order | One footer tab each, first |
| Top-level groups, sorted by `order` | One footer tab each, after the flat tabs |
| A group's sub-groups and entity links | Rows on the main screen after tapping the group's tab |
| Nested group (up to `MAX_NAV_DEPTH`, 8) | One more pushed screen per level; the same screen serves every depth |
| A group with no descendants is omitted | Same, at every level |
| Entity links hidden when the user cannot read the entity | Same (see Permissions) |

Footer tabs show the icon with a small label below. The bar scrolls horizontally, so every tab stays
reachable however many there are; none is dropped or truncated. A fixed **Search** tab is appended after
the schema-driven tabs when the app generates a search route (`app/api/search`); it is not tied to any
entity's `x-nav`.

An entity opens `/entity/<name>`: its native list when the entity has [entity screens](#entity-screens),
otherwise a screen saying "This screen is not available in the mobile app yet." The scheduled-task admin
link of the desktop sidebar has no mobile counterpart and is not generated.

### Icons

Group icons use the names allowed by `NAV_ICON_ALLOWLIST`. `mobile_nav.MOBILE_ICON_MAP` maps every
allowed name to a glyph from `@expo/vector-icons`; a test fails when the allowlist grows a name that is
not mapped. Three names have no outlined glyph in `MaterialIcons` and render a similar `-outline` glyph
from `MaterialCommunityIcons` instead, so they are not pixel-identical to the desktop icons:

| Allowed name | Mobile glyph |
|---|---|
| `WorkOutlined` | `MaterialCommunityIcons` `briefcase-outline` |
| `PeopleOutlined` | `MaterialCommunityIcons` `account-multiple-outline` |
| `SettingsOutlined` | `MaterialCommunityIcons` `cog-outline` |

Entities carry no icon key, so a flat entity tab uses one fixed icon (`description`) and a group declared
without an icon uses `folder`. Both defaults are constants in `mobile_nav.py`
(`DEFAULT_ENTITY_ICON`, `DEFAULT_GROUP_ICON`).

### Labels and language

Labels come from the same derivation as the sidebar (`to_title_case` of the entity or group name) and,
per locale, from `messages/<locale>.json` (`Nav.groups.<slug>`, `Nav.<camelCaseEntity>`). The language
button in the header cycles through the locales found in `messages/`; the choice is stored on the device.

## Header

| Desktop header | Mobile |
|---|---|
| Sidebar toggle | Not present: navigation is the footer |
| App title | Header |
| Language switcher | Header (cycles locales) |
| Search link | Footer (fixed Search tab) |
| Notification bell with unread badge | Header; polls `GET /api/notifications` every minute |
| Sign out | Header; revokes the device session, then clears the stored tokens |

The desktop-only user-identity link and sign-in link have no mobile counterpart yet.

## Permissions

`GET /api/mobile/nav` returns `{ hiddenHrefs }`: the nav hrefs the caller cannot open. It applies the
rule `app/[locale]/layout.tsx` applies to the desktop sidebar — an entity link is hidden when the caller
lacks `read` on the entity — through the same `canAccess()`. The app prunes its tree with the answer and
drops groups left empty. If the request fails the app shows no entity tabs rather than links the user may
not be allowed to open.

## Entity screens

An entity gets native list, detail and form screens when it needs nothing beyond plain fields and the
[relation pickers](#relation-pickers). `code_generator/mobile_entities.py` decides which entities qualify
and describes their fields; the templates are under `code_generator/templates/mobile/` (`entity/`,
`components/native/`, `lib/`).

| Screen | Route | Generated when |
|---|---|---|
| List (paged, 20 rows) | `/entity/<name>` | the entity has a list screen and REST routes |
| Detail | `/entity/<name>/<id>` | `x-generate.view` |
| New | `/entity/<name>/new` | `x-generate.new` |
| Edit | `/entity/<name>/<id>/edit` | `x-generate.edit` |
| Delete (one record, with a confirmation panel, from the detail screen) | | `x-generate.delete` |
| Delete several records (selection mode on the list) | | `x-generate.delete` and the `delete` permission |

An entity is left on the placeholder screen when it has no REST routes or no list screen, declares a
child grid, a one-to-one bridge other than the ones to `approvable` (with `ApprovalSection`) and `commentable`, a direct attachment, a custom component other than `ApprovalSection`, virtual
columns, attachments, `x-payment`, `x-splittable` without the approval section, a reservation, a state machine, edit/delete
guards without an approval or `x-self-only`, is the target of an `x-create-inline` field, relates to an entity that has no
REST routes, or has a field with no native widget (image or file URI, entity select, custom upsert
component). In the default schema `role`, `organization` and `app_setting` qualify; `user` (a custom component) keeps
the placeholder. The fixture schema in `code_generator/tests/fixtures/mobile_entity_gate/` covers the rest.

### List: sort, filter, search and bulk delete

The list screen passes the REST list's own parameters, so the rules are the server's, the same as the Web
list's: `sort=<field>:<asc|desc>` and `f.<field>=<value>` (`lib/_pagination.ts`, `parsePageOpts()`).

- **Sort.** *Sort* opens a panel with every scalar column of the form; a tap cycles ascending, descending and
  none. One column is sorted at a time.
- **Filter.** *Filter* opens a panel with a control for each text, number, decimal, boolean and enum field: a text
  box (substring match for text, equality for numbers), or a chip per member (enum) or *Yes* / *No* (boolean).
  Date, date-time and time fields can be sorted but not filtered, and a relation column holds an id, so it does
  neither. *Clear* resets the filters.
- **Search.** The search box above the list matches the row's title column (the first text column of the row,
  else the first text field) through the same `f.<field>` parameter; an entity with no text field has no box.
- Changing the sort, a filter or the search text restarts from the first page after a short pause; an older
  response never replaces a newer one.
- **Bulk delete.** A long press on a row starts a selection mode (a checkbox on each row, a count, *Delete* and
  *Cancel*) when the caller may delete (`useEntityCapabilities`, the module the detail screen uses). *Delete*
  shows the single delete's confirmation text and calls `DELETE /api/<entity>/bulk`, which checks permission and
  existence for each record. A refused record stays selected and the list shows the single delete's message for
  its reason (`getEntityFormErrorMessage`); the other records are removed.

### Relation pickers

A many-to-one foreign key, a one-to-one selector and a many-to-many declared with `x-outputType: list`
(the Web form's autocomplete list of existing records) are drawn by
`components/native/RelationPicker.tsx`:

| Relation | Control | Request body |
|---|---|---|
| Many-to-one foreign key | A button showing the selected record's label; *Select* opens a modal with a search box and the candidates. A tap selects and closes. An optional field has *Clear*. | `<column>: <id>` or `null` |
| One-to-one selector | The same control. A record that is already linked elsewhere is rejected by the service and shown with the shared `fieldAlreadyLinked` message. | `<column>: <id>` or `null` |
| Many-to-many | Chips for the selected records, each with a remove button; *Select* opens the modal, where a tap toggles a record and *Done* closes it. | `<name>_ids: [<id>, ...]`, an empty list when nothing is selected |

The candidates come from `GET /api/<target>/options` through `searchEntityOptions()` in `lib/entity-http.ts`
(`relation-picker-rest-route.md`). The request carries `q` (typed text, debounced), `ids` (the current
selection, so a selected record is listed whatever the text), `caller` (the hosting entity) and `context`
(the values of the form fields the field's `x-autocomplete-context` names, as JSON). The picker filters
nothing itself: permission scope, organization isolation, invalidated records, list-child attachment and the
target's `autocomplete_filter.ts` are the server's. A `403` from the options route (no `read` on the target)
shows the field disabled with the `Errors.fkPermissionDenied` message the Web form uses. The target need not
have native screens of its own.

The detail screen names a relation by the label column (`labelField` of the relationship) of the record the
REST detail embeds. A list row shows scalar columns only: the REST list does not embed related labels.

A required foreign key is checked by the same `form_validation.ts` the Web form runs (`Mobile Group is
required`), before any request. Form state, submit and error mapping stay in `use_entity_form.ts`; the picker
is presentation plus the options request.

### Approval

An entity that declares `x-approval` (a one-to-one bridge to `approvable` and the `ApprovalSection` view
component) gets the same screens plus an approval section on its detail screen
(`components/native/ApprovalSection.tsx`). The section lists the requests of the current round: the approver
role and the status, translated through `ApprovalRequestStatus`. The buttons follow the server's answer:

| Button | Shown on | Call |
|---|---|---|
| Approve, Reject | a request whose id is in `approval.actionable_request_ids` | `POST /api/approval_request/<id>/approve` or `/reject` |
| Withdraw | the section, when `approval.can_withdraw` is true and the entity declares `x-approval.on_withdrawn` (`HAS_ON_WITHDRAWN`) | `POST /api/approval_request/<id>/withdraw`, naming any pending request of the round (withdrawing closes the whole round) |

Each action opens a dialog with the optional message; Reject also takes a reason kind (Customer or Internal) and a
free-text reason. The call sends `{ message, reason, reason_kind }` and, on success, reloads the record, so the
status the approval wrote (`on_approved`, `on_rejected`, `on_withdrawn`) is shown. A failure is shown through the
entity's shared error mapping.

The app evaluates none of the approval rules (approver role held, every preceding stage approved, requestor
only). `GET /api/<entity>/<id>/capabilities` returns, next to the flags the Web section computes,
`approval.current_round_request_ids` and `approval.actionable_request_ids`, derived by the checks the approve and
reject routes run. The same answer carries `write_locks`; a record whose `edit_locked` or `delete_locked` is true
hides Edit or Delete. The form does not offer a value only the approval workflow may write
(`x-approval.on_approved` / `on_rejected` `set_fields`), as the Web form disables it.

`lib/<entity>/use_entity_approval_actions.ts` and `lib/approval_request/submit_predicate.ts` are copied into
`mobile/` unchanged; the screen reads `HAS_ON_WITHDRAWN` from the former.

### Split

An approval entity that declares `x-splittable` with a `quantityField` gets a split section on its detail
screen (`components/native/SplitSection.tsx`), below the approval section. The entity's `<ENTITY>_SPLIT` constant
in `lib/<entity>/mobile_client.ts` carries the quantity field and the fields every part names
(`perPartRequired`); the generated `split<Entity>()` posts to the same route the Web section calls,
`POST /api/<entity>/<id>/actions/split`, with `{ parts: [{ <quantityField>, <field>... }] }`.

The section follows the Web section's rules:

- It starts with two parts, each with a quantity and the required fields; a part can be added, and one can be removed
  while more than two remain.
- The section shows the quantity still unassigned (`Remaining`); the Split button is enabled only while it is zero.
- A required field that is a foreign key of the entity is the relation picker the entity's form uses (same target, label column
  and options route). A field named in `x-autocomplete-context` narrows the candidates by the record's stored value,
  as the Web picker does. Any other required field is a text input.
- The server re-checks the parts (at least two, quantities positive and summing to the record's, the fields named) and
  which records may be split (not already approved, split or rejected, and submitted for approval when the entity has
  `submit_on`). A refusal is shown with the server's own text and the section stays open. On success the record
  reloads and shows the status the split wrote.

The split route and its inventory handling are the Web ones; the app calls them and evaluates none of those rules.
An approval entity that is splittable but has no `quantityField` has no split section on the Web either.

### Comments

An entity that is commentable through the shared `commentable` bridge keeps its native screens, and its
detail screen ends with the comment thread (`components/native/CommentThread.tsx`). The comments are the
`comments` the REST detail embeds under the `commentable` key, in the order it returns them; the REST
detail already decodes an `@mention` to the user's name, so the thread shows `@Name` as plain text (the Web
links the name to the profile). The heading is `Fields.comments`.

Each comment has a reaction bar with one button per reaction type the comment reactions route accepts
(`COMMENT_REACTION_TYPES`; the labels are the `ReactionType` messages). The counts come from the detail; the
reactions the signed-in user made come from `GET /api/comment/<id>/reactions/toggle`, which the detail does not
carry. A tap sends `POST` to the same route, which adds the reaction or removes it, and the bar shows the
counts and the caller's reactions it returns; a failed request leaves the previous state. Both calls are in
`lib/comment-http.ts`.

The thread is read-only. Adding, editing and deleting a comment and the user lookup behind `@` have no
REST route (the Web calls Server Actions and `lib/mention/search.ts` directly), so the composer and the
mention picker are not drawn. An entity that declares an `x-mention` field of its own is still left on the
placeholder screen.

### Shared logic with the Web screens

The screens draw native controls and call the modules the Web screens call
([shared-ui-hooks.md](shared-ui-hooks.md)). `generate-code` renders these from the same templates and
contexts into `mobile/`, so each copy is identical to its Web counterpart:

| Module | Used for |
|---|---|
| `lib/<entity>/use_entity_form.ts` | form state, validation recording, submit, error-message mapping |
| `lib/<entity>/use_entity_capabilities.ts` | whether Edit and Delete are shown |
| `components/<entity>/form_validation.ts` | required-field and decimal checks |

`lib/_errors.ts` and `lib/authz.ts` in `mobile/` hold only the types those modules import.

The hooks need React 19: `use_entity_form.ts` passes an async function to `startTransition`, which the React
18 typings reject. The app therefore runs one Expo SDK's bundled set (Expo SDK 57: React 19.2,
React Native 0.86, `expo-router` 57, `@expo/vector-icons` 15). The versions are pinned together in
`templates/mobile/package.json.jinja2`; bump the whole set with `npx expo install --fix`, not one package.
`@playwright/test` is not part of the SDK and is pinned separately. The screens' own saving flag wraps the
transport call, so a save in flight is visible even where a transition does not track async work.

### Data access

`lib/<entity>/mobile_client.ts` has the same function names as the Web getters and Server Actions
(`fetch<Entity>Page`, `get<Entity>Detail`, `upsert<Entity>`, `remove<Entity>`) implemented as `fetch()` calls
to the entity's REST routes, which call the same service functions the Server Actions call. Pages are
zero-based, like the REST list. A save resolves to `{ ok: true, id }` or to an `ActionFailure` built from the
REST error body (`code`, `field`, `reason`, `messageKey`, `messageArgs`); it never rejects, because the form
hook runs the save inside a transition. Date, date-time and time fields are typed as text in the
`YYYY-MM-DD`, ISO and `HH:mm:ss` forms.

Messages come from `messages/<locale>.json` (`Common`, `Errors`, `ValidationMessages`) through
`mobile/lib/messages.ts`; field labels are the title-cased column names.

### Permissions

The "New" action needs a model-level answer before any record exists:

`GET /api/mobile/permissions?entity=<name>` returns the caller's `{ create, read, update, delete, import }`
for one entity, from the same `getModelPermissions()` as every other route (400 for a missing or malformed
name; all `false` for an entity the caller holds nothing on). On a record, `update` and `delete` are
overlaid with `operations` from `GET /api/<entity>/<id>/capabilities`. A form opened without `create`
shows a permission message instead of fields.

## Audit log

The audit log is a built-in feature, not a schema entity, so it is not among the entity screens. The app has
a read-only list and detail for it, reached from an **Audit Log** link that `mobile_nav.build_mobile_nav()`
adds (`include_audit_log=True`, as `generate_mobile_target()` passes it). The link sits where the desktop
sidebar puts it: in the `administration` group when the schema declares that group, as a flat footer tab
when it does not.

| Screen | Route | Reads |
|---|---|---|
| List (paged, 20 rows, newest first) | `/entity/audit_log` | `GET /api/audit_log?page=<n>&pageSize=20&sort=created_at:desc` |
| Detail (action, target table and id, actor, time, metadata as formatted JSON) | `/entity/audit_log/<id>` | `GET /api/audit_log/<id>` |

Both screens are registered in `lib/entity-registry.ts` under `audit_log` with no form, and are rendered from
`templates/mobile/audit_log/`. They send no write request. Permission is the server's: the link is hidden when
`GET /api/mobile/nav` lists `/audit_log` (the caller lacks `read` on `audit_log`, the rule the desktop sidebar
applies), and a list request that is refused with `403` shows the shared `Errors.permissionDenied` message. The
strings come from `EntityLabel.auditLog`, `Fields` (`action`, `actorUser`, `created_at`, `metadata`,
`targetId`, `targetTable`) and the `Common` / `Errors` namespaces; only those `EntityLabel` and `Fields` keys are
bundled.

## Authentication

The mobile app signs in with email and password and holds an access/refresh token pair.

| Route | Purpose |
|---|---|
| `POST /api/mobile/auth/token` | Password grant. Returns `{ access_token, refresh_token, token_type, expires_in }`. A user with MFA enabled gets `403 MFA_REQUIRED` until `mfa_code` is sent. Rate-limited per IP and email (`mobile:auth:token`). |
| `DELETE /api/mobile/auth/token` | Sign out: revokes the calling session. |
| `POST /api/mobile/auth/refresh` | Rotates the refresh token. Presenting a rotated-away token, or losing a concurrent rotation race, revokes the whole session. |
| `GET /api/mobile/auth/sessions` | Lists the caller's active devices. |
| `DELETE /api/mobile/auth/sessions/:id` | Revokes one of the caller's own device sessions. |

The access token is a 15-minute HS256 JWT signed with `AUTH_SECRET` and carrying `type: "mobile_access"`;
that claim is the only thing separating it from a web session JWT, so every verification path checks it.
Refresh tokens last 30 days and are stored as a keyed HMAC, never in plaintext (`mobile_session` table).
Access-token verification is stateless: a token issued just before sign-out or revocation stays valid for
the rest of its 15 minutes.

Generated REST routes call `authenticate()` (`lib/api-auth.ts`), which accepts either a mobile access JWT
or an API key (`X-API-Key` / `Authorization: Bearer`); a JWT always has three dot-separated segments and
an API key never does. `authenticateApiKey()` is unchanged. `GET /api/notifications` accepts the same
bearer token when an `Authorization` header is present and the session cookie otherwise.

## Running and testing

The Playwright suite drives the Expo **web** bundle in Chromium. It needs three processes, started
explicitly on ports you choose: the Next.js API, `expo start --web`, and the same-origin proxy that joins
them. Entity REST routes send no CORS headers, so a browser that loads the app from one port and the API
from another is blocked; the proxy makes both one origin. Native iOS and Android builds are not subject
to CORS.

```bash
cd mobile && npm install
PROXY_PORT=8096 API_PORT=3012 WEB_PORT=8095 node scripts/same-origin-proxy.js
EXPO_PUBLIC_API_BASE_URL=http://localhost:8096 npx expo start --web --port 8095
EXPO_WEB_URL=http://localhost:8096 npm run test:e2e:mobile:pw   # from the repository root
```

`scripts/run_mobile_entity_playwright.sh` does all of this in a disposable copy of the working tree with its
own docker project and ports, and runs the specs in two modes (the footer specs assume the default schema's
tabs, the entity specs need the fixture entities):

```bash
bash scripts/run_mobile_entity_playwright.sh               # fixture schema: entity-crud.spec.ts, relation-pickers.spec.ts, comments.spec.ts
MODE=default bash scripts/run_mobile_entity_playwright.sh  # default schema: the other specs
```

The fixture mode merges `code_generator/tests/fixtures/mobile_entity_e2e_gate/` (`mobile_note` with full
CRUD, `mobile_log` list-and-view only, `mobile_task` with a required foreign key, a many-to-many and a one-to-one
selector to `mobile_group` / `mobile_tag` / `mobile_profile`, `mobile_org_item` with a foreign key to `organization`, `mobile_request` with `x-approval`, `mobile_shipment` with `x-approval` and `x-splittable`, `mobile_thread` commentable and list-and-view only) into the copy's schema, as `scripts/compose_child_datagrid_e2e_fixture.py`
does for the other end-to-end fixtures, and signs in as the seeded administrator. `mobile/scripts/serve-web-with-proxy.js`
runs the Expo web server and the proxy as one process so the runner can stop both.

- `mobile/e2e/entity-crud.spec.ts` covers list paging, create, edit, delete with confirmation, the shared
  validation (no request is sent for an invalid form), a server-side rejection, and every permission-hidden
  action (New, the form without `create`, Edit and Delete on a record the caller cannot change, a
  list-and-view-only entity).
- `mobile/e2e/list-capabilities.spec.ts` covers sorting (the request parameter and the row order), a filter and
  its clearing, the search box, the selection mode with its confirmation, the bulk route call, a refused record and
  the missing `delete` permission.
- `mobile/e2e/relation-pickers.spec.ts` covers the pickers: select, search with the current selection kept,
  the hosting entity and form values sent with the search, the shared required-field check, edit, a
  disabled field without read on the target, clear, a one-to-one already linked elsewhere, adding and
  removing many-to-many records, an emptied set sent as an empty list, and the organization picker offering
  only organizations the user belongs to. The fixture mode seeds the records it needs.
- `mobile/e2e/comments.spec.ts` covers the thread of a commentable entity (`mobile_thread`): the comments in
  order with their author, a mention shown as a name, an empty thread, no composer, the counts and the
  caller's own reaction, adding and removing a reaction through the route, and a reaction that is still set
  after the screen is reopened.
- `mobile/e2e/approval-actions.spec.ts` covers the approval section on `mobile_request`: a request for another
  role offers no action, approve (message sent, status and record locked), reject (message, reason and kind
  sent), withdraw (dialog cancel, then the round closes and the record returns to its withdrawn value), a decided
  request, a later stage that is not yet actionable, and the form leaving out the values only the approval may write.
- `mobile/e2e/split-action.spec.ts` covers the split section on `mobile_shipment`: Split enabled only when the
  parts add up to the quantity, adding and removing parts (never fewer than two), cancel, the server refusing a part
  with no group and an already-approved record (its text shown), and a completed split sent with the
  quantities and the groups picked, after which the record shows its split status.
- `mobile/e2e/*.spec.ts` are curated, hand-written specs, one per flow, not generated. A mobile change
  ships a spec for the flow it changes.
- `mobile/scripts/real-browser-verify.js` is the reusable real-browser check. It selects a preset with
  `FLOW_TYPE` (`assert`, `drill`); a new need adds a preset instead of a new script. Never launch
  Chromium with `--disable-web-security` — it hides the CORS-class gaps this check exists to catch.
- `mobile/e2e/audit-log.spec.ts` (default schema) covers the Audit Log link under Administration, the real
  list route, paging with the newest-first sort, the detail with its metadata and no edit or delete action,
  a missing entry, a link hidden by the nav route and a refused request.
- `code_generator/tests/test_mobile_nav.py` covers the tree built from the nav configuration, including the
  audit log link.
- `code_generator/tests/test_mobile_audit_log.py` covers the generated audit log screens: registered, REST
  read-only, no permission logic of their own, linked in the nav tree and bundled strings.
- `code_generator/tests/test_mobile_entities.py` covers which entities get screens, the relation field
  descriptions, that the screens and pickers call the shared modules and the options route, the REST client
  and the React version the shared hooks need.
- `cypress/e2e/api/mobile_auth.cy.ts`, `mobile_nav.cy.ts` and `mobile_permissions.cy.ts` cover the REST routes.

The suite runs the web bundle, not native rendering, so native-only behavior (secure storage prompts,
the biometric lock, native icon fonts) is not exercised by it. `npm run test:e2e:mobile:pw` is an optional
check and is not part of the mandatory gate.

## Not implemented yet

- Entity screens for an entity that declares anything beyond plain fields, the relation pickers, the approval
  section and the comment thread: child grids, attachments and payment.
- Adding, editing and deleting comments, and the `@` user lookup in a comment, in the app. The REST routes for
  them exist (`comment-and-mention-rest-routes.md`); the screens that use them are not built.
- Submitting a record for approval (the "(re)submit" button). Resubmitting is a Server Action
  (`submit_for_approval.ts`) with no REST route, so the app has nothing to call.
- Creating the referenced record in place from a foreign-key field (`x-create-inline`) and the one-to-one
  bridge grid (`x-bridge`).
- The native date pickers (dates are typed as text).
- CSV export and import: the export and import routes accept a session cookie or an API key but not a mobile
  access token (`resolveActorId()` in `lib/api-auth.ts`), so the screens cannot call them yet (Issue #883).
- Scheduled task administration (the task list, each task's last run, run now). The list and the last-run
  status are read only by the Web admin page's Server Component (`loadAdminOverview()`), and the rerun,
  resolve and skip actions are Server Actions; the one REST route, `/api/scheduled-tasks/<task>`, starts a
  run but lists nothing, so a client has no route to build the screen on.
- Translated field labels.
