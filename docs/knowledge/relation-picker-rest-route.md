# Relation Picker REST Route (`GET /api/{entity}/options`)

A form that selects a related record (many-to-one foreign key, one-to-one, many-to-many) fills its
picker with `search{Entity}Options()` from `lib/{entity}/getters.ts`, a Server Action. A client that
can only call REST routes, such as the mobile app, reaches the same candidates through a generated
route.

## Route

`app/api/{entity}/options/route.ts` is generated for every entity with a REST surface (`x-generate.api`
not `false`), whatever its other `x-generate` flags. An entity with `api: false` has no picker route.

| Query parameter | Meaning |
|-----------------|---------|
| `q` | Text to match, as in the web picker (substring match on the searchable fields of the entity label). |
| `ids` | Comma-separated record ids, at most 200, to look up. With no `q`, only those records are returned. |
| `limit` | Integer from 1 to 200, default 50. Anything else is `400`. |
| `caller` | Name of the entity whose form hosts the picker; lets the target narrow its candidates (an entity attached to a parent through a list child offers only unattached records). A value that is not a lowercase entity name is `400`. |
| `context` | JSON object (at most 4096 characters) with the hosting form's current values, passed to the entity's `autocomplete_filter.ts`. It can only narrow the candidates. Anything but a JSON object is `400`. The route accepts it on every entity; which values a form sends is chosen by `x-autocomplete-context` (see [x-autocomplete-context.md](x-autocomplete-context.md)). |

The response is a JSON array of the rows the web picker receives, in the same shape. The `organization`
route takes only `q`, `ids` and `limit`.

## One implementation

The route does not query anything itself. After authenticating the caller it calls the very function
the Server Action path calls, `search{Entity}Options()` (for `organization`,
`searchAssociatedOrganizationOptions()` in `lib/organization/getters_associated.ts`), so the web and the
REST route cannot diverge on:

- the access scope (a caller with only Creator or Assignee read sees only those rows, `x-self-only`
  restricts to the caller's own rows, `x-filter-values` applies);
- strict organization isolation (an entity with `organization_id` returns only rows of organizations
  the caller belongs to, plus tenant-wide rows when the column is nullable; the `organization` picker
  returns only the caller's organizations);
- invalidated records being left out;
- the entity's `autocomplete_filter.ts` (see [x-autocomplete-context.md](x-autocomplete-context.md) for the schema key that makes a web form send context to it);
- the row mapping (including Decimal values as strings).

## Authentication and permission

`requireCaller()` (`lib/api-auth.ts`) accepts the same credentials as the other generated routes: a mobile
access token or an API key in `Authorization: Bearer` / `X-API-Key`, and, when no credential header is
sent, the NextAuth session cookie. An invalid credential is `401`; it never falls back to the cookie.

`read` on the target entity is checked before the search (`403` otherwise). This differs on purpose from
the Server Action, which returns an empty result flagged `permissionDenied` so a form can render the field
disabled (see `fk-read-permission-graceful-degradation.md`); a REST client gets the status code.

The search function reads the acting user from `getSessionUserId()`. `withActor()` (`lib/api-auth.ts`)
runs it with the authenticated caller as that user through `runAsActor()` in `lib/_request_scope.ts`
(an `AsyncLocalStorage`). Only server code that imports that module can set the actor; the getters stay
`'use server'` files that take no user id from the client.

The route counts against the `api:read` rate-limit bucket.

## Relation kinds

| Kind | Picker data |
|------|-------------|
| many-to-one foreign key | `GET /api/{target}/options` |
| one-to-one selector | `GET /api/{target}/options`. The web form's "available targets" list (`getAvailable{Target}sFor{Parent}`, targets not yet linked to another record) has no REST route; a client filters the options itself or reads the linked record. |
| many-to-many | `GET /api/{target}/options` for the candidates; the selected values travel with the record on create and update. |

## Tests

- `code_generator/tests/test_api_options_route.py`: the route is written for each `api: true` entity and
  not for an `api: false` one, calls the shared search function after the permission check, validates its
  parameters, and is described in the OpenAPI document.
- `cypress/e2e/api/fk_autocomplete_options.cy.ts`: authentication (API key, mobile token, invalid
  credentials), search, id lookup, `limit`, parameter validation, `403` without read on the target,
  organization isolation of the `organization` picker (also through a mobile token), invalidated users
  left out.
- `G3.5` in each generated `cypress/e2e/api/<entity>.cy.ts` whose entity carries an organization column:
  a record of a foreign organization is not returned by `GET /api/<entity>/options`, one the caller may
  see is.
- `lib/_request_scope.test.ts`, `lib/api-auth.test.ts`: the actor override and `requireCaller()`.
