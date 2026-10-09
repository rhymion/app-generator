# Comment and Mention REST Routes

The comment box on an entity's edit form adds, edits and deletes comments and offers `@`-mention
candidates through Server Actions. A client that can only call REST routes, such as the mobile app,
reaches the same behavior through generated routes. They are thin wrappers: after authenticating the
caller they run the functions the form runs, so the web and REST paths cannot diverge on the stored
message, the notifications or the checks.

## Routes

| Route | Written when | Does |
|-------|--------------|------|
| `POST /api/{entity}/{id}/comments` | The entity has a comment thread and a REST surface (`api`, `view`, and `new`, `edit`, `delete` or `invalidate` not all `false`) | Adds a comment. Body `{ "message": "..." }`; answers `201 { "id": "..." }`. |
| `PATCH /api/{entity}/{id}/comments/{commentId}` | Same | Changes the message. Body `{ "message": "..." }`; answers `200 { "success": true }`. |
| `DELETE /api/{entity}/{id}/comments/{commentId}` | Same | Deletes the comment; answers `204`. |
| `GET /api/mention/users?q=<text>` | Any field in the schema has `x-mention: true` | Searches the users the caller may mention; answers `200 { "options": [{ "id", "name", "email" }], "permissionDenied": false }`. |

The comment routes follow the entity's comment thread, whether it is the shared `commentable` bridge
(`type: one-to-one_bridge`, one `comment` table) or a comment child of its own. An entity without a
comment thread has no comment routes; a schema without `x-mention` has no search route.

All four accept a mobile access token or an API key (`Authorization: Bearer` / `X-API-Key`) through
`authenticate()`. A request without a valid credential is `401`. The session cookie is not read: the
web uses the Server Actions. The comment routes count against the `api:write` rate-limit bucket, the
search against `api:read` (`429` with `Retry-After` when exceeded).

## One implementation

Each route runs, as the authenticated caller (`withActor()` in `lib/api-auth.ts`), the function the edit
form calls:

| Route | Function it runs | Defined in |
|-------|------------------|------------|
| `POST .../comments` | `add{Entity}Comment()` | `lib/{entity}/actions.ts`, built by `_build_comment_actions` / `_build_comment_actions_bridge` in `code_generator/build_context.py` |
| `PATCH .../comments/{commentId}` | `update{Entity}Comment()` | same |
| `DELETE .../comments/{commentId}` | `delete{Entity}Comment()` | same |
| `GET /api/mention/users` | `searchMentionUserOptions()` | `lib/mention/search.ts` (`mention_search.ts.jinja2`) |

So these stay the web's own: how the message is stored (the `@[user_id:<id>]` markers are kept as sent),
the `comment_created` notification to the record's creator and assignee, the `mentioned_in_comment`
notification to each mentioned user (on edit, only to users the edit newly mentions; never to the author),
the revalidation of the entity's pages, and the candidate rules of the search. The add action returns the
id of the new comment, which the route passes on.

## What the routes check

The Server Actions do not check the caller's access to the record themselves: the web reaches them from
the edit form, which is shown only to a user who may edit the record. A REST route has no such page in
front of it, so each comment route checks access first, the same way `PUT /api/{entity}/{id}` does:

1. `update` on the entity (`requireApiPermission`), before the record is read, so a caller with no access
   path at all learns nothing about whether the record exists (`403`).
2. The record is read with `get{Entity}Detail()`, the getter behind `GET /api/{entity}/{id}`. A record
   outside the caller's organizations, or not the caller's own for an `x-self-only` entity, is not found
   (`404`).
3. `resolvePermissions()` on that record: Creator and Assignee grants count, and a caller who cannot update
   this record gets `403` (`Access denied: {entity}.update`).

`update` is the permission the web form requires before it shows the comment box. Reading a record does
not allow commenting on it.

For `PATCH` and `DELETE` the comment must belong to the record in the path; a comment of another record,
or an unknown id, is `404`. Then the Server Action's own rules apply:

- Edit: only the author. Anyone else gets `403` (`Not authorized to edit this comment`), whatever their
  permissions.
- Delete: the author, or a caller with `delete` on the entity. A caller with neither gets `403`.

## The detail's comments

`GET /api/{entity}/{id}` shows each comment's message with the `@[user_id:<id>]` markers decoded to `@Name`.
It also lists the markers as `mentions` (`{ "id", "name" }` per marker, in order of appearance, a user
mentioned twice listed twice), so a client that edits the decoded text can send the markers back; the
mobile comment box does (`mobile-app.md`, Comments).

## Request validation

The message is trimmed, as the web does. A body that is not JSON, a missing or non-string `message`, an
empty or blank message, and a message longer than 10000 characters are `400`. The search takes an
optional `q` of at most 200 characters (`400` beyond that).

## Mention search

`searchMentionUserOptions()` returns at most 20 users ordered by name whose organizations include one of
the caller's, filtered by `q` (case-insensitive substring of the name; an empty `q` lists the first 20).
A caller without any organization membership gets an empty list. A caller who may not read `user` gets
`{ "options": [], "permissionDenied": true }` with status `200`, the same result the web picker receives
so it can show "suggestions unavailable"; this differs on purpose from `GET /api/{entity}/options`, which
answers `403` (see `relation-picker-rest-route.md`).

## OpenAPI

The entity's OpenAPI paths include the three comment routes when they are written, and the document
includes `/api/mention/users` and the `MentionUserOption` schema when the search route is written
(`code_generator/generators_openapi.py`).

## Tests

- `code_generator/tests/test_comment_mention_rest_routes.py`: the routes are written for a commentable
  entity and not otherwise, run the Server Actions after the permission and record checks, hold no write
  of their own, validate the message; the OpenAPI paths.
- `scripts/check_mention_gate_fixture.sh` (`npm run test:mention-gate`): the generated routes type-check
  against the shared libraries' signatures.
- `npm run test:comment-rest-e2e-gate` (`scripts/check_comment_rest_e2e_gate_fixture.sh`): builds and
  runs a fixture app with a commentable entity scoped by organization
  (`code_generator/tests/fixtures/comment_rest_e2e_gate/`), because the repository's own schema has no
  entity with a comment thread. Its Cypress spec covers authentication with an API key and a mobile
  access token, add, edit and delete, the mention notifications, `403` without `update` and for a
  non-author, `404` for a record or comment of another organization or record, message validation, and
  the search's organization scope, the 20-user limit and the `permissionDenied` result.
