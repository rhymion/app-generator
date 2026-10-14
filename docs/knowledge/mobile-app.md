# Mobile App (Expo)

With the opt-in below, `generate-code` also renders an Expo (React Native) project into `mobile/`. Its
navigation is built from the **same source as the desktop sidebar** — `x-nav` on entities and
`x-nav-groups` at the top level, resolved by `code_generator/nav_config.py` — so the screens need no
further mobile-specific key. `mobile/` is generated output: it is git-ignored, except for the hand-written
Playwright files in `mobile/e2e/`, `mobile/playwright.config.ts` and `mobile/scripts/`.

To build an installable Android `.apk`, see [mobile-executable.md](mobile-executable.md).

## Turning generation on

The Expo app is **off by default**. Set `x-generator.mobile.enabled: true` in the schema to generate it:

```yaml
x-generator:
  mobile:
    enabled: true
```

- The key is read by `generate.py` at generation time (`validate.mobile_generation_enabled`). Absent or
  `false` means no `mobile/` output at all: no entity screens, no nav, no Expo dependencies.
- `validate_generator_config` rejects a non-boolean `enabled`, a non-mapping `mobile` and any other
  sub-key under `x-generator.mobile`.
- This repository's own schema leaves the flag off. The mobile tests and fixtures
  (`mobile_entity_gate`, `mobile_entity_e2e_gate`) set it, and `scripts/run_mobile_entity_playwright.sh`
  sets it in every mode and refuses to run when `mobile/` was not generated.
- Turning the flag from `true` to `false` stops generating `mobile/`; files from earlier runs are removed by
  `npm run cleanup` (manifest-tracked, hash-guarded) as for any other generated file. The hand-written
  `mobile/e2e/`, `mobile/playwright.config.ts` and `mobile/scripts/` stay.
- The flag gates generated output only. The hand-written server side is always present: the token routes
  under `app/api/mobile/` (`auth/*`, `nav`, `permissions`), `lib/mobile-auth.ts`, and the mobile JWT branch of
  `lib/api-auth.ts`. The web mobile-viewport Cypress specs (`cypress/e2e/mobile/`) are Web output and are
  not gated either.
- A project that regenerates from this generator and wants to keep `mobile/` must set the flag in its own
  schema.

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
link of the desktop sidebar has a mobile counterpart when the schema declares a task (see
[Scheduled task administration](#scheduled-task-administration)).

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

A reservation entity (`x-reservation`) is drawn like any other entity: the reservation runs on the server in the
generated service layer, shared with the Web. The REST routes return HTTP 409 with `code: 'CAPACITY'` when no pool
capacity is available and `code: 'RESERVATION_LOCKED'` when a count-mode reservation is already allocated, and the
transport reads `code` before the status, so the form shows the same capacity / locked texts as the Web. The field
the server fills in (the allocated pool reference) is only as required as the schema declares it. A count-mode
reservation with a `lines` child gets the [row editor](#child-rows), so `RESERVATION_LOCKED` is reachable on mobile for it.

A field declared with `x-entity-select` holds the name of one of the schema's entities (the Web form draws a select
of every entity). The app draws it as the enum chips: each chip shows the entity's title (`Purchase Order`), the
request body carries the entity name (`purchase_order`), and the list and detail screens show the title. The field spec
carries the titles as `optionLabels`, by position beside `options`; the server stores the string as is. In the default
schema `approval_flow` (`entity_name`) and `permission` (`name`) qualify.

An entity is left on the placeholder screen when it has no REST routes or no list screen, declares a
child that is neither a picker nor an [editable child collection](#child-rows) (an independent child with its own screens,
or a row with a field the row editor cannot draw), a one-to-one bridge other than the ones to `approvable` (with `ApprovalSection`), `commentable` and `attachable` (with `AttachmentSection`), an `ApprovalSection` or `AttachmentSection` component without its bridge, virtual
columns, `x-splittable` without the approval section, a state machine, edit/delete
guards without an approval or `x-self-only`, relates to an entity that has no
REST routes, or has a field with no native widget (image or file URI). Hand-written components
(`x-custom-components`, `x-custom-component`) are not a reason: they get an [insertion point](#hand-written-components).
In the default schema every entity qualifies except `setting` (no list screen). The fixture schema in `code_generator/tests/fixtures/mobile_entity_gate/` covers the rest.

`generate-code` reports which entities were left on the placeholder screen and why. It prints them at the end of the
mobile step, grouped by reason (the first failing check of `mobile_ineligible_reason()`), and writes the same list to
`mobile/MOBILE_ENTITIES.md`, so it can be read without rerunning the generator. When every entity has a screen the log
prints nothing and the note says so. The report changes no screen.

### List: sort, filter, search and bulk delete

The list screen passes the REST list's own parameters, so the rules are the server's, the same as the Web
list's: `sort=<field>:<asc|desc>` and `f.<field>=<value>` (`lib/_pagination.ts`, `parsePageOpts()`).
The state and the request it produces are `lib/_list_query.ts`, copied into `mobile/lib/` unchanged and used by
the Web list panel too, so the two cannot disagree on what a sort, a filter or the search box means; see
[list-search-panel.md](list-search-panel.md).

- **Sort.** *Sort* opens a panel with every scalar column of the form except internal bridge foreign keys (`approvable_id`, `attachable_id`, ...), and every relation display column (below); a tap cycles ascending, descending and
  none. One column is sorted at a time (the Web list sorts several; `cycleSort(sort, key, multi)` takes the
  difference).
- **Filter.** *Filter* opens a panel with a control for each text, number, decimal, boolean and enum field: a text
  box (substring match for text, equality for numbers), or a chip per member (enum) or *Yes* / *No* (boolean).
  Date, date-time and time fields can be sorted but not filtered. *Clear* resets the filters.
- **Relation columns.** A foreign key shown in `x-display.table` whose target has a single-column label field is
  sorted and filtered by the related record's label, keyed by the relation name (`room_type`, not
  `room_type_id`). The keys come from the same `sort_filter_relation_fields` that fills `RELATION_FILTER_FIELDS`
  in `getters.ts`, so the mobile and Web lists cannot disagree; the filter is a text box (substring match on the
  label), and the server's permission and organization checks apply as for any list request. The column is
  offered by the panel only (`<ENTITY>_QUERY_FIELDS`); the form does not draw it.
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

A many-to-one foreign key, a one-to-one selector, a many-to-many declared with `x-outputType: list` and a
one-to-many `x-outputType: list` attached through a nullable foreign key (the Web form's autocomplete list of
existing records) are drawn by
`components/native/RelationPicker.tsx`:

| Relation | Control | Request body |
|---|---|---|
| Many-to-one foreign key | A button showing the selected record's label; *Select* opens a modal with a search box and the candidates. A tap selects and closes. An optional field has *Clear*. | `<column>: <id>` or `null` |
| One-to-one selector | The same control. A record that is already linked elsewhere is rejected by the service and shown with the shared `fieldAlreadyLinked` message. | `<column>: <id>` or `null` |
| Many-to-many | Chips for the selected records, each with a remove button; *Select* opens the modal, where a tap toggles a record and *Done* closes it. | `<name>_ids: [<id>, ...]`, an empty list when nothing is selected |
| One-to-many list (for example `procedure.children`) | The same control as the many-to-many. The offered records are the child entity's own; it has no `x-relationship`, so the target is the child's entity name. | `<name>_ids: [<id>, ...]`, replacing the saved set |

The candidates come from `GET /api/<target>/options` through `searchEntityOptions()` in `lib/entity-http.ts`
(`relation-picker-rest-route.md`). The request carries `q` (typed text, debounced), `ids` (the current
selection, so a selected record is listed whatever the text), `caller` (the hosting entity) and `context`
(the values of the form fields the field's `x-autocomplete-context` names, as JSON). The picker filters
nothing itself: permission scope, organization isolation, invalidated records, list-child attachment and the
target's `autocomplete_filter.ts` are the server's. A `403` from the options route (no `read` on the target)
shows the field disabled with the `Errors.fkPermissionDenied` message the Web form uses.
A one-to-many list offers only records that no other record owns; when it lists the entity's own kind the
form also sends the edited record's `id` in `context`, so the route leaves out the record itself and its
ancestors (a record that is already a selected child is shown as a chip, not as a candidate).
The service still refuses an attach that would break these rules, and the form shows the server's message. The target need not
have native screens of its own.

### Direct attachment fields

A field declared with `x-relationship: {target: attachment, type: direct}` is drawn by
`components/native/AttachmentInput.tsx`: the attached file's name (a link that opens the file), *Select* to
pick a file with the system document picker (`expo-document-picker`, added to the app's dependencies only
when some entity has such a field) and, once a file is attached, *Clear*. The form holds the `attachment`
row's id; the whole row is kept beside it so the name shows without another request.

Choosing a file takes two requests, the same two the Web form makes (`SingleAttachmentUpload`, mode `fk`):

| Step | Request | Result |
|---|---|---|
| Store the file | `POST /api/upload` (multipart, field `file`) | `{ url }`; a type the route does not accept or a file over `UPLOAD_MAX_BYTES` is refused with its own text, which the field shows |
| Create the row | `POST /api/attachment/direct` with `{ name, path, type }` | `201 { id, name, path, type }` |

The entity form then submits the id under the column name (`<column>: <id>`, `null` when cleared), and the
detail and edit screens read the row the REST detail embeds under the column name without `_id`. The file name
is stored encrypted and returned decrypted, as on the Web screens.

Both routes accept a mobile access token, an API key or the browser session (`requireCaller()`), and nothing
else changes about who may do what: any authenticated user may store a file and create the (still unlinked)
row; the entity's own `create` / `update` permission and organization rules decide whether the link is saved,
exactly as for the Web form. `/api/attachment/direct` runs the Web action (`createDirectAttachment`) as the
authenticated caller, so there is one implementation of the row. The route rejects a `type` outside the
`attachment.type` enum, an empty or over-long name and a `path` that is not a site-relative path or an
`http(s)` URL. A file stored through the Google Cloud Storage upload route is served by `/api/gcs/...`, which
requires a browser session, so the link on the detail screen opens only where that session is shared.

### Hand-written components

A project's own components (a status chip, a dashboard, a field with its own control) cannot be ported by the generator.
The mobile screens therefore read the declarations the Web screens already read, with no further schema key, and leave an
insertion point for a native counterpart: `x-custom-components` (entity level, targets `list`, `view`, `edit`) and
`x-custom-component` (field level, targets `upsert`, `view`). An entity is no longer left on the placeholder screen only
because it declares one. `ApprovalSection` and `AttachmentSection` are not insertion points: the screens serve them natively
(see [Approval](#approval) and [Attachments of an `attachable` bridge](#attachments-of-an-attachable-bridge)).

**Where each component is mounted** (the position of the Web counterpart):

| Declaration | Native position |
|---|---|
| entity `list` | the list's search / sort / filter row, after the *Filter* button |
| entity `view` | the detail screen, after the fields and the built-in sections (approval, split, attachments), before the comment thread |
| entity `edit` | the form, after the inputs; the create form shows it too, as on the Web |
| field `upsert` | replaces that field's input (label and control) on the form |
| field `view` | replaces that field's row (label and value) on the detail screen |

A field with an `upsert` target and no `view` target that holds a string (a password, an API key) is never listed, sorted,
filtered or shown on the detail screen; the REST detail does not return it. A field component is sent with the save only
once it has changed the value, so a form that never touched it does not overwrite the stored value with a blank.

**Where the files are.** The generator writes one native stub per component, once, and never overwrites it (the same
write-once rule as the other hand-maintained stubs); `cleanup` does not delete one you edited. Entity components are
`mobile/components/<entity>/custom/<ComponentName>.tsx`, field components are
`mobile/components/<entity>/custom/fields/<FieldPascalCase>.tsx` (one file per field, serving both targets). A component's
Web `path` is ignored: the native component is always found by name. Commit the implemented files to the project's own
source of truth, as for the other stubs, so a fresh rebuild keeps them.

**The stub draws nothing.** A generated stub returns `null`. No placeholder text, marker or "not implemented" notice reaches
the user, because some Web features (CSV export and import, for example) are deliberately not built on mobile. The developer
learns about a new stub from the `ACTION REQUIRED` summary at the end of `generate-code`, which lists each file and where it
is mounted.

**Props.** The contract is generated into `mobile/lib/custom-component.ts` and follows what the Web components receive:

```ts
// Entity components (list, view, edit) -- the static `props` of the schema entry arrive as further props.
type EntityComponentProps = {
  record?: ({ id: string } & Record<string, unknown>) | null; // absent on the list, null on the create form
  permissions?: ModelPermissions;                              // the caller's flags (for the record on view / edit)
  reload: () => void;                                          // re-read the list page / the record
} & Record<string, unknown>;

// Field components: `onChange` and `isEdit` are set on the form only.
type FieldUpsertProps = { value: string | boolean; onChange: (next: string | boolean) => void; isEdit: boolean };
type FieldViewProps = { value: unknown };
```

The Web view and edit components also receive `currentUserRoleIds` and `currentUserId`; the native ones do not (the app
holds no session user), so a native component that needs them reads them from the REST API itself.

The fixture entity is `mobile_gadget`; `mobile/e2e/custom-components.spec.ts` runs against hand-written files placed before
generation (the generator keeps files that exist) and against a stub left as generated.

### Attachments of an `attachable` bridge

An entity that owns attachments through the polymorphic bridge (`attachable_id` with
`x-relationship: {type: one-to-one_bridge, target: attachable}`, shown on the Web screens by the `AttachmentSection`
component in its `x-custom-components`) keeps its native screens; as with the approval bridge, the bridge and the
component come together, and a bridge without the component stays on the placeholder. The component's `showImages` /
`showFiles` props (both default to `true`) decide which of the two lists, *Images* (`image`) and *Attachments* (`file`),
the screens draw.

`components/native/AttachmentList.tsx` draws the lists. The detail screen lists each attachment's name (a link that opens
the file) in stored order, with a thumbnail for an image, from the `attachments` the REST detail embeds under the bridge
(`attachable.attachments`, already decrypted). The edit form adds *Add* (the system document picker, which uploads
the file with `POST /api/upload`), *Delete* and move up / down to each list. Nothing is saved while editing: the form
saves the record first, then sends the whole list of each type that changed to the attachments route. As on the Web, the
create form has no attachment section (attachments can only be added once the record exists).

| Step | Request | Result |
|---|---|---|
| Store a file | `POST /api/upload` (multipart, field `file`) | `{ url }`; a refused type or size is shown on the section |
| Save a type's list | `PUT /api/<entity>/<id>/attachments` with `{ type, items: [{ id?, name, path }] }` | `200 { ok: true }` |

`PUT /api/<entity>/<id>/attachments` is generated for an owner with the bridge, the component, a detail screen and an edit
screen. It runs the Web panel's own Server Action (`setAttachmentsForBridge`, `lib/attachment/bridge_actions.ts`) as the
authenticated caller (mobile access token or API key), so the replace semantics are the Web's: the listed order is the stored order,
an item with an `id` keeps its row, an item without one is created, and a row of that type that is not listed is deleted.
The other types are untouched. File names are stored encrypted, as on the Web.

Access is the owner's: the caller needs `update` on the entity (and, for a record-level grant, on that record), and the
record is read through the entity's detail getter, so a record of another organization (or, for an `x-self-only` entity,
not the caller's own) answers `404` and writes nothing. A listed `id` must already be an attachment of this record, so the
id of another record's (or another organization's) attachment cannot be used to take it over (`400`). The route also
rejects a `type` outside the `attachment.type` enum, an empty or over-long name, a `path` that is not a site-relative path
or an `http(s)` URL, and more than 100 items.

If the second request is refused, the record itself is already saved; the form stays open and shows the server's text on the
section, with the edits kept.

### Create the referenced record in place (`x-create-inline`)

A many-to-one foreign key that declares `x-create-inline: true` shows a *Create new* button beside *Select*
(`picker-create-<field>`). It opens the target's own native create form in a modal over the hosting form,
so the hosting form's unsaved values stay where they are. The target's form is the one it has anywhere
else, so its validation, required fields and organization scoping apply; it saves through the target's
REST create route and the shared `useEntityForm().submit(formData, onCreated)`. On success the modal
closes, the new record is selected (its label is read back from the options route) and the field shows the
`Common.createdInlineNotice` text: the record is already saved even if the hosting form never is. Cancel
closes the modal and leaves the field unchanged.

- The button appears only when `GET /api/mobile/permissions?entity=<target>` says the caller may create the
  target; the create route stays the authority.
- The control exists only when the target has native screens with a create form. A target that keeps the
  placeholder screen (it has an independent child, for example) leaves the field a plain picker, and `generate-code`
  prints which field. The Web form still offers its dialog.
- The generated hosting `FormUpsert.tsx` imports the target's `FormUpsert` and hands it to the picker;
  the target's `FormUpsert` takes optional `onCreated` and `onCancel` props and then reports the new id and
  cancels through them instead of navigating. Nesting depth is 1 (validation rejects a target that declares the key itself).
- Many-to-many fields and one-to-one selectors offer no control, as on the Web.

### Payment checkout (`x-payment`)

An `x-payment` entity has the same native screens. Creating a record is `POST /api/<entity>`, which answers
`{ record, checkoutUrl }`. `upsert<Entity>()` returns the new id with the `checkoutUrl`, and the form opens
that URL with `expo-web-browser` (`lib/checkout.ts`, generated, with the dependency, only when an entity
declares `x-payment`; only `http(s)` URLs are opened). The app has no payment logic: the record is provisional
until the payment provider's success page or webhook confirms it, and the provider's cancel page or the
expiring session removes it (`stripe-payment-integration.md`).

When the buyer returns to the app, the form reads the record back. A record that is gone (the checkout was
cancelled or expired) keeps the form open with `Payment.cancelMessage`; a kept record opens the detail screen
with the `Payment.returnedMessage` notice. The app does not show *paid* versus *waiting for confirmation*:
no REST route exposes the `payable` status (the `payable` model is internal to `lib/payment/`), so that
distinction needs a route first. The provider's success and cancel pages are Web pages in the in-app browser
and need a signed-in Web session; the webhook is the dependable confirmation.

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

An entity that declares an `x-mention` field of its own is still left on the placeholder screen.

#### Writing comments

On an entity that has the comment write routes (`comment-and-mention-rest-routes.md`), the thread also writes;
an entity without them keeps a read-only thread. Every write goes through `lib/comment-http.ts`, which calls
`POST /api/<entity>/<id>/comments`, `PATCH .../comments/<commentId>` and `DELETE .../comments/<commentId>`; the
routes run the Web's own add, edit and delete functions after their permission and organization checks, and a
refusal is shown as the server's answer (`Errors.permissionDenied` for a `403`). The screen decides only what to
offer, and the server decides again on every write:

| Control | Offered when | The server requires |
|---|---|---|
| Comment box | The record's capabilities allow `update` | `update` on the record |
| Edit | The signed-in user wrote the comment (the `sub` claim of the access token) | The author |
| Delete (asks for confirmation) | The user wrote the comment, or has `delete` on the entity | The author, or `delete` on the entity |

The Web box offers Edit and Delete to the author only, and only when the user also has `delete`; the mobile screen
follows the routes' own rule, which is the wider one.

After a write the record reloads, so the thread shows what the server stored. A failed write keeps the text in the box.

#### Mentions

When the schema has an `x-mention` field, typing `@` followed by text (the `@` at the start or after whitespace, so
an e-mail address does not count) searches `GET /api/mention/users?q=` after 250 ms and lists the candidates; a
caller who may not read users gets `Errors.permissionDenied` in place of the list. Picking a candidate inserts
`@Name ` into the box. The shared logic is in `lib/comment-composer.ts`: the box shows names, and
`encodeMessage()` puts back `@[user_id:<id>]` for each picked mention when the message is sent, matching the
picked mentions in order so two users with the same name keep their own ids. A hand-typed `@Name` that was not
picked stays plain text, as on the Web. To edit a comment, the REST detail lists its `mentions` (`id` and `name`
per marker, in order of appearance, next to the decoded `message`), which the box starts with, so editing the
text around a mention keeps the mention.

### Shared logic with the Web screens

The screens draw native controls and call the modules the Web screens call
([shared-ui-hooks.md](shared-ui-hooks.md)). `generate-code` renders these from the same templates and
contexts into `mobile/`, so each copy is identical to its Web counterpart:

| Module | Used for |
|---|---|
| `lib/<entity>/use_entity_form.ts` | form state, validation recording, submit, error-message mapping |
| `lib/<entity>/use_entity_capabilities.ts` | whether Edit and Delete are shown |
| `components/<entity>/form_validation.ts` | required-field, decimal and date / date-time / time checks |
| `lib/_date_value.ts` | the date, date-time and time rules (valid value, normalized shape), copied unchanged from the Web `lib/` |

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
hook runs the save inside a transition.

### Date, date-time and time fields

`components/native/FieldInput.tsx` draws a date, date-time or time field with `DateValueInput`: a text box showing
the format (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ssZ`, `HH:mm:ss`) and a *Today* / *Now* button. There is no native
calendar or clock picker. When the box loses focus, a valid value is rewritten to the shared shape (a date-time
typed with an offset becomes a UTC instant, one typed without an offset is read as local time) and an invalid
one shows a field error and stays in the box. `form_validation.ts` then refuses to submit it, so no request is
sent. The rules are `lib/_date_value.ts`; the Web form validation, the server write guard
(`service_validation.ts`) and the mobile input all call it, so the three agree on what a valid value is. A value
the server cannot parse as a date is a `VALIDATION` error (HTTP 400, `reason: invalid`) on the REST routes and the
Server Actions alike; it no longer reaches Prisma. A time column is a full DateTime on the wire (the Web time picker
sends an instant): the form edits the local time of day as `HH:mm:ss`, and `formDataToBody()` sends it as the instant
of that time today (`timeOfDayToInstant()`), while a stored value is shown back as local `HH:mm:ss`. A blank value is not this check's concern: a required field is
rejected by the required-field check.

Messages come from `messages/<locale>.json` (`Common`, `Errors`, `ValidationMessages`) through
`mobile/lib/messages.ts`; field labels are the title-cased column names.

### Permissions

The "New" action needs a model-level answer before any record exists:

`GET /api/mobile/permissions?entity=<name>` returns the caller's `{ create, read, update, delete, import }`
for one entity, from the same `getModelPermissions()` as every other route (400 for a missing or malformed
name; all `false` for an entity the caller holds nothing on). On a record, `update` and `delete` are
overlaid with `operations` from `GET /api/<entity>/<id>/capabilities`. A form opened without `create`
shows a permission message instead of fields.


## Child rows

A one-to-many child collection that the parent saves with its own record (the Web form's editable grid, declared
without `x-outputType`) is drawn as a row editor, so the parent keeps its native screens.

- **Form.** The collection is one field of kind `child_rows`. Each row draws the child's own fields with the controls the
  form already has: text, number, decimal, boolean, enum, date, date-time, time and a relation picker for a foreign key
  (the parent's own foreign key is not drawn). A required column without a schema default is required in the row; a
  column with a schema default starts a new row at that value and is left out of the request when blank, so the server
  applies the default. Columns the server fills in (`x-readonly`, `x-readonly-fields`) and bridge foreign keys
  without a relationship (`*able_id`) are not drawn. **Add** appends an empty row and **Delete** removes one.
- **Request.** The rows travel as one JSON entry of the form data and become the property array of the REST body
  (`lines: [{ id?, ...fields }]`). A saved row keeps its `id`, so the server updates it in place; a row without an
  `id` is created and a saved row that is missing is deleted. This is the shape the generated POST and PUT routes already
  accepted; the server remains the authority for validation.
- **Required fields.** Before sending, the form names the first row that lacks a required field (`Lines 1: Quantity is required`).
  Everything else is checked by the server, as for the Web grid.
- **Detail.** The collection is listed read-only, one line per row (`Field: value, Field: value`), with a relation shown
  by its label.
- **Not covered.** A child that is independent (it has its own screens and writes itself), a many-to-many without
  `x-outputType: list`, a `list` child that is not a many-to-many (such as a self-referencing `children` list) and a row
  field the editor cannot draw (image, file URI, entity select, custom upsert component) keep the entity on the placeholder
  screen; the generation log names the property and, for a row field, the field.

The fixture entity is `mobile_invoice` (`lines`: text, number, enum with a default, date and a required foreign key);
`mobile/e2e/child-rows.spec.ts` creates, edits (keeping, changing, removing and adding rows) and reloads it.

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
`templates/mobile/audit_log/`. They send no write request. Both routes authenticate with `authenticate()` (the mobile access token or a service API key), like the entity routes. Permission is the server's: the link is hidden when
`GET /api/mobile/nav` lists `/audit_log` (the caller lacks `read` on `audit_log`, the rule the desktop sidebar
applies), and a list request that is refused with `403` shows the shared `Errors.permissionDenied` message. The
strings come from `EntityLabel.auditLog`, `Fields` (`action`, `actorUser`, `created_at`, `metadata`,
`targetId`, `targetTable`) and the `Common` / `Errors` namespaces; only those `EntityLabel` and `Fields` keys are
bundled.

## Scheduled task administration

When the schema declares a scheduled task (a top-level `x-scheduled-tasks` entry or an entity-level
`x-scheduled-task`), the app has a **Scheduled Task Run** screen for the same operators as the Web admin page. The
link is added by `mobile_nav.build_mobile_nav()` (`include_scheduled_tasks`, as `generate_mobile_target()` passes
it) in the `administration` group when the schema declares that group, as a flat footer tab when it does not. Without a
declared task nothing is generated: no screen, no registry entry, no link, no strings.

| Screen | Route | Calls |
|---|---|---|
| Overview for a business date: one row per task with its status, start and finish, message, why it did not run, the task's `interval`, then the failed or stuck runs of other dates | `/entity/scheduled_task_run` | `GET /api/scheduled-task-runs[?date=YYYY-MM-DD]` |
| Rerun, mark resolved, skip (a reason field is shown beside resolve and skip) | same screen | `POST /api/scheduled-task-runs/<task>/<rerun\|resolve\|skip>` with `{ business_date, reason? }` |

The previous and next buttons move the business date by one day. The screen is rendered from
`templates/mobile/scheduled_task_run/` and registered in `lib/entity-registry.ts` under `scheduled_task_run` with no
detail and no form.

The screen decides nothing about who may act. The buttons shown for a row are exactly the `actions` flags the server
returns for it, and the server re-checks the `ScheduledTaskRunner` role on every call: `GET /api/mobile/nav` lists
`/scheduled_task_run` in `hiddenHrefs` for a caller without the role (the link is hidden), a refused overview shows
`ScheduledTaskRun.forbidden`, and an action answered `403` shows `ScheduledTaskRun.resultForbidden`. Every other
refusal (`NOT_ALLOWED`, `BLOCKED`, `RUNNING`, `REASON_REQUIRED`, `FAILED`, ...) is the `{ ok: false, code }` body of the
route, mapped to the matching `ScheduledTaskRun.result*` string; the rows are reloaded after each action. The strings
are the whole `ScheduledTaskRun` namespace. The routes themselves are described in `scheduled-task-operations.md`.

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

The app keeps the refresh token in `expo-secure-store` (`lib/token-storage.ts`). On a device with biometrics or a
PIN enrolled, a standalone or development build locks it behind that check (`requireAuthentication`), and the
build's `Info.plist` carries `NSFaceIDUsageDescription` from the `expo-secure-store` config plugin. Expo Go has no
such text in its own `Info.plist`, so the app stores and reads the token there without the lock
(`Constants.executionEnvironment` is `storeClient`). The check runs in one function for both save and read, so the
two always agree, and a locked save that fails outside Expo Go is not retried unlocked. Face ID therefore cannot
be verified in Expo Go; only a standalone or development build locks the token. Web uses `localStorage`.

Generated REST routes call `authenticate()` (`lib/api-auth.ts`), which accepts either a mobile access JWT
or an API key (`X-API-Key` / `Authorization: Bearer`); a JWT always has three dot-separated segments and
an API key never does. `POST /api/upload` and `POST /api/attachment/direct` call `requireCaller()`, which
accepts the same credentials and falls back to the session cookie. `authenticateApiKey()` is unchanged. `GET /api/notifications` accepts the same
bearer token when an `Authorization` header is present and the session cookie otherwise.

## Running and testing

The Playwright suite drives the Expo **web** bundle in Chromium. It needs three processes: the Next.js API,
the Expo web server and the same-origin proxy that joins them. Entity REST routes send no CORS headers, so a
browser that loads the app from one port and the API from another is blocked; the proxy makes both one origin.
Native iOS and Android builds are not subject to CORS.

### The entry point

`npm run test:e2e:mobile:pw` (from the repository root of the generator) runs
`scripts/run_mobile_entity_playwright.sh` and is the entry point. The script builds a disposable copy of the
working tree with its own docker compose project, three ports derived from the checkout's path and a throwaway
`AUTH_SECRET`, starts the three processes, and runs the specs in three modes, one after another, each on a
fresh stack (about 20 minutes in all). The exit status is non-zero if any mode failed, and every mode runs
even when an earlier one failed. The schema differs per mode because the footer specs assume the default
schema's tabs and the entity specs need the fixture entities:

| Mode | Schema of the copy | Specs | Tests |
|------|--------------------|-------|-------|
| `fixture` | default plus `code_generator/tests/fixtures/mobile_entity_e2e_gate/` | `entity-crud`, `relation-pickers`, `list-capabilities`, `inline-create-checkout`, `comments`, `approval-actions`, `split-action`, `reservation`, `attachments`, `child-rows`, `entity-select`, `bridge-attachments`, `custom-components` (13 specs) | 103 |
| `default` | default, unmodified | `audit-log`, `auth`, `drill-down`, `footer-nav` (4 specs) | 15 |
| `scheduled` | default plus `code_generator/tests/fixtures/scheduled_task_e2e_gate/`, the test user holds the `ScheduledTaskRunner` role | `scheduled-task` (1 spec) | 6 |

```bash
npm run test:e2e:mobile:pw                                    # all three modes
MODE=fixture bash scripts/run_mobile_entity_playwright.sh     # one mode (fixture, default or scheduled)
MODE=fixture PW_ARGS='entity-crud.spec.ts' bash scripts/run_mobile_entity_playwright.sh   # one mode, narrowed
```

The environment variables the script honours are `MODE`, `PW_ARGS` (one mode only; refused with the default
`all`), `PORT_SLOT` (0-899, picks another port set) and `GATE_KEEP_BUILD_DIR=1` (keeps the copy). It ignores
`EXPO_WEB_URL`, `TEST_EMAIL` and `TEST_PASSWORD` from the caller: it never runs against an already running
stack, it starts its own and signs in as the seeded administrator (`admin@example.com` / `password123`). The
checkout's `node_modules` must be a real directory (a plain `npm ci`); the script refuses a symlinked one,
because `next build` (Turbopack) cannot resolve it in the copy.

The specs are bound to this repository's own default and fixture schemas. They are not run in app-template or
another consumer repository: its schema has different footer tabs and none of the `mobile_*` fixture entities.
In CI the job `mobile-playwright` runs the same command when the diff touches a path the suite exercises, and
the update-generator gate has the same path-triggered step (`scripts/mobile_pw_gate_applies.sh` holds the path
list).

### Running specs against a stack you prepared

`npm run test:e2e:mobile:pw:raw` is the bare Playwright invocation. It refuses to start unless
`MOBILE_PW_PRECONDITIONS_READY=1` is set (the script sets it), because almost every spec fails with a
timeout against a stack that does not match. The stack must provide:

1. The schema the specs need: a spec of the `fixture` mode needs the `mobile_*` fixture entities merged in,
   their SQL seed rows and the write-once native component stubs of `mobile_gadget` (see the script); the
   `default` specs assume the default schema's footer tabs; `scheduled-task.spec.ts` needs the scheduled-task
   fixture and the `ScheduledTaskRunner` role. A mismatch is a precondition failure, not a generator defect.
   The fixture and scheduled modes cannot be reproduced by hand in practice; use the script.
2. `x-generator.mobile.enabled: true` in the schema and `generate-code`, so that `mobile/package.json` exists
   (with the flag off `npx expo` finds nothing to run), then `cd mobile && npm install`. `mobile/` is its own
   npm project; installing at the repository root does not provide `expo`. In a consumer repository the
   generator lives in the `app-generator/` submodule, so the directory is `app-generator/mobile/` and the
   commands run from `app-generator/`.
3. A seeded and fully granted administrator: `npm run db:seed-baseline` and `npm run db:grant-all-permissions`
   (with `NODE_ENV=test`), and `TEST_EMAIL=admin@example.com TEST_PASSWORD=password123`. Without the seeded
   user every spec fails in `login()`.

```bash
cd mobile && npm install
PROXY_PORT=8096 API_PORT=3012 WEB_PORT=8095 EXPO_PUBLIC_API_BASE_URL=http://localhost:8096 node scripts/serve-web-with-proxy.js
# from the repository root, with the API running on port 3012:
MOBILE_PW_PRECONDITIONS_READY=1 EXPO_WEB_URL=http://localhost:8096 \
  TEST_EMAIL=admin@example.com TEST_PASSWORD=password123 npm run test:e2e:mobile:pw:raw -- footer-nav.spec.ts
```

`serve-web-with-proxy.js` runs the Expo web server and the proxy as one process so the runner can stop both;
`same-origin-proxy.js` is the proxy alone.

**Open the proxy URL (here `http://localhost:8096`), not the Expo dev server's own address (`8095`), which Expo
opens in the browser automatically.** A page loaded from 8095 is cross-origin to the API (the REST routes send no CORS
headers), so the browser blocks the sign-in request and the navigation lookup.

When the server cannot be reached (server down, device offline, or a request the browser blocked), the sign-in screen
shows "Could not reach the server" instead of an error screen. When only the navigation lookup (`GET /api/mobile/nav`)
fails, the footer shows only the fixed Search tab plus a notice that the menu could not be loaded (`nav-load-failed`).
The footer stays fail-closed in that case: the notice explains the empty footer, it does not reveal anything. An empty
footer with that notice is a connection problem, not missing permissions. `mobile/e2e/network-failure.spec.ts` covers
these screens.

The fixture mode merges `code_generator/tests/fixtures/mobile_entity_e2e_gate/` (`mobile_note` with full
CRUD, `mobile_log` list-and-view only, `mobile_task` with a required foreign key, a many-to-many and a one-to-one
selector to `mobile_group` / `mobile_tag` / `mobile_profile`, `mobile_org_item` with a foreign key to `organization`, `mobile_ticket` with an `x-create-inline` foreign key to `mobile_category`, `mobile_order` with `x-payment`, `mobile_request` with `x-approval`, `mobile_shipment` with `x-approval` and `x-splittable`, `mobile_thread` commentable and list-and-view only, `mobile_invoice` with a child collection) into the copy's schema, as `scripts/compose_child_datagrid_e2e_fixture.py`
does for the other end-to-end fixtures, and signs in as the seeded administrator.

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
  removing many-to-many records, an emptied set sent as an empty list, a self-referencing one-to-many list
  (`mobile_step.children`: free records offered, a record owned elsewhere, the record itself and its ancestors
  not offered, the changed set sent as `children_ids`), and the organization picker offering
  only organizations the user belongs to. The fixture mode seeds the records it needs.
- `mobile/e2e/inline-create-checkout.spec.ts` covers *Create new* (the target form in a modal, the new record
  selected, the hosting form's values kept, cancel, the target's validation, no control without the
  server's create flag or without the key) and the checkout (the hosted URL opened after the save, the
  returned notice on the detail screen), with the fake payment provider.
- `mobile/e2e/comments.spec.ts` covers the thread of a commentable entity (`mobile_thread`): the comments in
  order with their author, a mention shown as a name, an empty thread, the counts and the caller's own reaction,
  adding and removing a reaction through the route, and a reaction that is still set after the screen is
  reopened; adding a comment (the request sent, a blank box, a refusal shown with the text kept, no box without
  `update`); the `@` lookup (the search request, the marker sent, an unpicked name sent as text, an e-mail
  address, suggestions unavailable); and editing and deleting (the author's comment, mentions kept as markers,
  cancel, a comment by another user deletable but not editable, the delete confirmation and a refused delete).
- `mobile/e2e/approval-actions.spec.ts` covers the approval section on `mobile_request`: a request for another
  role offers no action, approve (message sent, status and record locked), reject (message, reason and kind
  sent), withdraw (dialog cancel, then the round closes and the record returns to its withdrawn value), a decided
  request, a later stage that is not yet actionable, and the form leaving out the values only the approval may write.
- `mobile/e2e/split-action.spec.ts` covers the split section on `mobile_shipment`: Split enabled only when the
  parts add up to the quantity, adding and removing parts (never fewer than two), cancel, the server refusing a part
  with no group and an already-approved record (its text shown), and a completed split sent with the
  quantities and the groups picked, after which the record shows its split status.
- `mobile/e2e/entity-select.spec.ts` covers the `x-entity-select` field on `mobile_rule`: the chips showing entity
  titles, the entity name saved on create and on edit, the detail and list screens showing the title, and a missing
  entity blocking the save before any request.
- `mobile/e2e/attachments.spec.ts` covers the direct attachment fields on `mobile_document` (a required and an
  optional one): a picked file uploaded with the access token and its row id saved with the record, a required
  field blocking the save before any request, clearing an optional field, the edit form starting from the
  attached files and replacing one, the server's refusal of a file type shown with nothing attached, and the
  detail screen opening the file from its name.
- `mobile/e2e/bridge-attachments.spec.ts` covers the attachments of `mobile_asset` (an `attachable` bridge): no section on the
  create form, adding files, moving one and removing one on the edit form, the whole list sent in the listed order for
  the type that changed and nothing for the others, images and files as separate lists, the detail screen listing the
  saved set without controls, the server's refusal of a file type, a refused save keeping the edits and showing the
  error on the section, and opening a file from its name.
- `code_generator/tests/fixtures/comment_rest_e2e_gate/cypress/e2e/attachments_rest.cy.ts` covers
  `PUT /api/cr_asset/{id}/attachments` (see `npm run test:comment-rest-e2e-gate`): a mobile access token (accepted), no
  credential or a bad key (401), replace semantics (listed order, reorder, removal, images and files separate), malformed
  bodies (400), a caller without `update` (403), a record of a foreign organization (404, nothing written) and an id that
  belongs to another record (400, nothing taken over).
- `cypress/e2e/api/direct_attachment_rest.cy.ts` covers `POST /api/upload` and `POST /api/attachment/direct` with a
  mobile access token (accepted), no credential or a tampered token (401), malformed input (400), the decrypted
  name on the linked record, and a holder without `update` on the entity who can store a file but not link it (403).
- `mobile/e2e/*.spec.ts` are curated, hand-written specs, one per flow, not generated. A mobile change
  ships a spec for the flow it changes.
- `mobile/scripts/real-browser-verify.js` is the reusable real-browser check. It selects a preset with
  `FLOW_TYPE` (`assert`, `drill`); a new need adds a preset instead of a new script. Never launch
  Chromium with `--disable-web-security` — it hides the CORS-class gaps this check exists to catch.
- `mobile/e2e/audit-log.spec.ts` (default schema) covers the Audit Log link under Administration, the real
  list route answering 200 to the mobile access token, paging with the newest-first sort, the detail with its metadata and no edit or delete action,
  a missing entry, a link hidden by the nav route and a refused request.
- `code_generator/tests/test_mobile_nav.py` covers the tree built from the nav configuration, including the
  audit log link.
- `code_generator/tests/test_mobile_audit_log.py` covers the generated audit log screens: registered, REST
  read-only, no permission logic of their own, linked in the nav tree and bundled strings.
- `code_generator/tests/test_mobile_entities.py` covers which entities get screens, the relation and attachment field
  descriptions, the *Create new* wiring and the checkout flow, the attachment upload helpers and the two attachment
  routes, that the screens and pickers call the shared modules and the options route, the REST client
  and the React version the shared hooks need.
- `cypress/e2e/api/mobile_auth.cy.ts`, `mobile_nav.cy.ts` and `mobile_permissions.cy.ts` cover the REST routes.

The suite runs the web bundle, not native rendering, so native-only behavior (secure storage prompts,
the biometric lock, native icon fonts) is not exercised by it. `npm run test:e2e:mobile:pw` is a path-triggered
step of the update-generator gate (it applies when the change touches a path the suite exercises) and is not
part of the unconditional steps.

## Native end-to-end flows (Maestro, Android)

`generate-code` writes one [Maestro](https://maestro.dev) flow for every entity that has native screens, to
`mobile/e2e/generated/maestro/<entity>.yaml`, plus `subflows/sign_in.yaml`. The directory is git-ignored: a project does not
track generated output. `code_generator/mobile_e2e.py` builds the flows from the specs `build_mobile_entity_spec` returns, that is
from the same `mobile_ineligible_reason` decision that emits the screens, so an entity has a flow exactly when it has screens.
These flows run on a real Android runtime. The Playwright suite above drives the react-native-web build in a browser and cannot
see native-only behavior (secure storage, native pickers, the keyboard, hardware back); the flows are additional, not a replacement.

Each entity flow does the following, addressing the `testID`s the native templates emit (Maestro's `id:` selector):

1. Signs in with `E2E_EMAIL` / `E2E_PASSWORD` and waits for `footer-bar`.
2. Opens the entity's list: one `footer-tab-<entity>` tap for a flat tab, or the tap on the group's footer tab followed by one
   `nav-row-<slug>` tap per sub-group and a final `nav-row-<entity>`. An entity that no footer tab reaches gets no flow.
3. Checks the list chrome (`list-<entity>`, `list-title`, `list-page`, no `list-error`).
4. Opens the first row's detail screen (`view-<entity>`) and returns, when a row exists. With `E2E_REQUIRE_SEED_ROWS=1` the flow
   fails when the list shows no row.
5. For an entity that can be created and viewed, creates one record. Every required field must be a text, number, decimal,
   boolean, enum, date, date-time or time field and not read-only: text gets `e2e <E2E_RUN_ID> <key>`, a number gets `1`, a
   decimal `1.5`, an enum its first option, a date type the "Today"/"Now" shortcut, a boolean stays off. An entity whose
   required fields need a relation picker, an attachment or child rows gets no create step. The flow ends on `view-<entity>`.

Seed data is the one the Playwright runner uses: `db:seed-baseline` (the `admin@example.com` administrator) and
`db:grant-all-permissions`. Records beyond that are not seeded, so on a freshly seeded database the detail step is skipped for
entities with no rows.

### Running the flows

`scripts/run_mobile_native_e2e.sh` is the entry point:

- `bash scripts/run_mobile_native_e2e.sh validate` (the default) runs `maestro check-syntax` on every generated flow. It needs the
  Maestro CLI only (`MAESTRO_BIN`, default `maestro` on `PATH`), no emulator and no APK, and says in its last line that nothing
  was executed.
- `APK=<path> bash scripts/run_mobile_native_e2e.sh run` installs the APK on the attached device or emulator and runs the flows
  with `maestro test`. The caller prepares the rest: the API (with the seeded database) at the URL the APK was built with
  (`EXPO_PUBLIC_API_BASE_URL`, baked in at build time; an emulator reaches the host as `10.0.2.2`) and the APK itself
  (`expo prebuild` plus `gradle assembleDebug`; see `docs/knowledge/mobile-executable.md`). `E2E_APP_ID` defaults to
  `com.anonymous.<slug>`, the application id `expo prebuild` assigns when `app.json` declares none; set it when the project
  declares its own.

The script never passes silently: a missing CLI, adb, APK or attached device exits with status 3 and the word `UNAVAILABLE`, and a
missing or invalid flow exits with status 1. The Android emulator needs hardware acceleration: the user must be able to open
`/dev/kvm` (on Linux, membership of the `kvm` group). Without it the emulator is unusable, so only `validate` can run.

This step is not part of the update-generator completion gate: it needs an emulator, an APK build of about ten minutes and
a prepared stack. The flows are validated, not executed, by the pytest suite (`code_generator/tests/test_mobile_e2e.py`).

### Growing the flows

The minimal set above is the base. Later steps add, in this order: list filter/sort/search; relation pickers; child rows,
inline create and attachments; comments; approval and split actions; reservation, custom components, scheduled tasks, audit log.
The Playwright specs under `mobile/e2e/` already cover each of these on the web build and are the source for the assertions.

## Not implemented yet

- Entity screens for an entity that declares anything beyond plain fields, the relation pickers, direct attachment
  fields, the attachments of an `attachable` bridge, the approval section, the comment thread with its comment box and
  mentions, creating the referenced record in place, payment checkout and the insertion points for
  [hand-written components](#hand-written-components): child grids. A plain URL
  field with `x-uri-kind: file` or `image` is not drawn either.
- Submitting a record for approval (the "(re)submit" button). Resubmitting is a Server Action
  (`submit_for_approval.ts`) with no REST route, so the app has nothing to call.
- The one-to-one bridge grid (`x-bridge`).
- The paid / waiting status of an `x-payment` record (no REST route exposes it).
- Native calendar and clock pickers (date, date-time and time fields are typed text with a *Today* / *Now* button).
- CSV export and import: the export and import routes accept a mobile access token (`resolveActorId()` in
  `lib/api-auth.ts` dispatches a bearer token by shape), but the app has no CSV screens. Bulk import and export
  stay in the Web admin screens.
- Translated field labels.
