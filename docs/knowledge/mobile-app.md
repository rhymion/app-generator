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

An entity without relations gets native list, detail and form screens. `code_generator/mobile_entities.py`
decides which entities qualify and describes their fields; the templates are under
`code_generator/templates/mobile/` (`entity/`, `components/native/`, `lib/`).

| Screen | Route | Generated when |
|---|---|---|
| List (paged, 20 rows) | `/entity/<name>` | the entity has a list screen and REST routes |
| Detail | `/entity/<name>/<id>` | `x-generate.view` |
| New | `/entity/<name>/new` | `x-generate.new` |
| Edit | `/entity/<name>/<id>/edit` | `x-generate.edit` |
| Delete (one record, with a confirmation panel, from the detail screen) | | `x-generate.delete` |

An entity is left on the placeholder screen when it has no REST routes or no list screen, declares a
relation (many-to-one, one-to-one, direct attachment, children), a custom component, virtual columns,
comments, attachments, `x-payment`, `x-splittable`, `x-create-inline`, a reservation, a state machine,
edit/delete guards or `x-self-only`, or has a field with no native widget (image or file URI, entity
select, custom upsert component). Selecting a foreign key or many-to-many value goes through the REST
route `GET /api/<entity>/options` (`relation-picker-rest-route.md`), but the app has no picker screen
yet, so those entities stay on the placeholder.
The default schema has no such entity; the fixture schema in
`code_generator/tests/fixtures/mobile_entity_gate/` does.

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
bash scripts/run_mobile_entity_playwright.sh               # fixture schema: mobile/e2e/entity-crud.spec.ts
MODE=default bash scripts/run_mobile_entity_playwright.sh  # default schema: the other specs
```

The fixture mode merges `code_generator/tests/fixtures/mobile_entity_e2e_gate/` (`mobile_note` with full
CRUD, `mobile_log` list-and-view only) into the copy's schema, as `scripts/compose_child_datagrid_e2e_fixture.py`
does for the other end-to-end fixtures, and signs in as the seeded administrator. `mobile/scripts/serve-web-with-proxy.js`
runs the Expo web server and the proxy as one process so the runner can stop both.

- `mobile/e2e/entity-crud.spec.ts` covers list paging, create, edit, delete with confirmation, the shared
  validation (no request is sent for an invalid form), a server-side rejection, and every permission-hidden
  action (New, the form without `create`, Edit and Delete on a record the caller cannot change, a
  list-and-view-only entity).
- `mobile/e2e/*.spec.ts` are curated, hand-written specs, one per flow, not generated. A mobile change
  ships a spec for the flow it changes.
- `mobile/scripts/real-browser-verify.js` is the reusable real-browser check. It selects a preset with
  `FLOW_TYPE` (`assert`, `drill`); a new need adds a preset instead of a new script. Never launch
  Chromium with `--disable-web-security` — it hides the CORS-class gaps this check exists to catch.
- `code_generator/tests/test_mobile_nav.py` covers the tree built from the nav configuration.
- `code_generator/tests/test_mobile_entities.py` covers which entities get screens, that the screens call the
  shared modules, the REST client and the React version the shared hooks need.
- `cypress/e2e/api/mobile_auth.cy.ts`, `mobile_nav.cy.ts` and `mobile_permissions.cy.ts` cover the REST routes.

The suite runs the web bundle, not native rendering, so native-only behavior (secure storage prompts,
the biometric lock, native icon fonts) is not exercised by it. `npm run test:e2e:mobile:pw` is an optional
check and is not part of the mandatory gate.

## Not implemented yet

- Entity screens for an entity with a relation, and with them every feature that lives on such a screen:
  the REST route for selecting a foreign key or many-to-many value exists
  (`relation-picker-rest-route.md`), but the picker screens that use it are not built. The same goes for
  child grids, approval, comments, attachments and payment.
- Bulk delete, the native date pickers (dates are typed as text), CSV import and export.
- Translated field labels.
