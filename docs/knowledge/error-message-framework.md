# Error Message Framework

**Status**: Design — approved (2026-08-14); Implementation: this same effort
**Scope**: All generated entities in app-generator-2
**Implementation task**: this document's own implementation effort

---

## Problem Statement

The requirement: error messages should be actionable for the user — but must not leak internal
schema details or cross-org existence. Today's state has three problems:

1. **Production erasure**: Next.js strips raw `error.message` from the client in production. All Server
   Action errors (including validation errors, stale-update warnings, permission denials) appear as
   "Something went wrong!" with a digest hash — no actionable information.

2. **Inconsistent transport**: Reservation-specific errors (`InsufficientPoolCapacityError`,
   `ReservationMutationError`) are returned inline (`{ error: string }`). All other errors are thrown
   and hit the full-page `error.tsx` boundary. No rationale for this asymmetry exists.

3. **Wrong HTTP status codes on the API path**: Validation errors return HTTP 500 (should be 422).
   Stale updates return HTTP 500 (should be 409). This breaks API consumers' ability to distinguish
   user errors from server bugs.

---

## Empirical Error Inventory

Tested on the running test server (worktree: subtask513b, port 20711, with an earlier
org-isolation check applied, 2026-08-01).

### API Route path (`X-API-Key` authentication)

| ID | Scenario | HTTP | Body | Source |
|----|----------|------|------|--------|
| A1 | Missing API key | 401 | `{"error":"Missing API key. Provide X-API-Key header..."}` | `lib/api-auth.ts authenticateApiKey` |
| A2 | Invalid API key | 401 | `{"error":"Invalid API key."}` | `lib/api-auth.ts authenticateApiKey` |
| A3 | Entity not found (genuine) | 404 | `{"error":"Not found"}` | template explicit check |
| A4 | Org isolation on GET/PUT/DELETE | 404 | `{"error":"Not found"}` | template: org-scoped `findFirst` returns null |
| A5 | Org isolation on POST (before the org-isolation fix) | 201 | success (security gap — fixed) | — |
| A6 | Org isolation on POST (after the org-isolation fix) | **500** ❌ | `{"error":"Organization access denied"}` | service.ts org check (reveals existence — see Disclosure Policy) |
| A7 | Permission denied (read) | 403 | `{"error":"Access denied: parent1.read"}` | `lib/api-auth.ts requireApiPermission` |
| A8 | Permission denied (create/update/delete) | 403 | `{"error":"Access denied: model.op"}` | `lib/api-auth.ts requireApiPermission` |
| A9 | Read-only field changed | 400 | `{"error":"Field {f} is read-only and cannot be changed"}` | template explicit |
| A10 | Validation error — required field missing | **500** ❌ | `{"error":"Name is required"}` | `handleApiError` generic fallback (empirically confirmed) |
| A11 | OTO relation already linked | **500** ❌ | `{"error":"{label} is already linked"}` | `handleApiError` generic fallback |
| A12 | Reservation capacity exhausted | 409 | `{"error":"No available {entity} for reservation"}` | template explicit catch |
| A13 | Reservation mutation conflict | 409 | `{"error":"..."}` | template explicit catch |

### Server Action / Server Component path (UI)

| ID | Scenario | User sees | Source layer |
|----|----------|-----------|--------------|
| U1 | ~~Not authenticated (org entity path)~~ — **unreachable, see below** | ~~error.tsx: "User not authenticated" (dev) / redacted (prod)~~ | `lib/authz.ts getSessionUserIdOrThrow` → throw |
| U2 | ~~Not authenticated (non-org entity path)~~ — **unreachable, see below** | ~~error.tsx: "Access denied: model.op" (dev) / redacted (prod)~~ | empty perms → `assertPermission` → throw |
| U3 | Permission denied — LIST page | error.tsx (full page) | `getters.ts assertPermission` → throw |
| U4 | Permission denied — DETAIL page | error.tsx (full page) | `getters.ts assertPermission` → throw |
| U5 | Permission denied — CREATE form access | error.tsx (full page) | `getters.ts assertPermission` → throw |
| U6 | Permission denied — UPDATE submit | error.tsx (full page) | `actions.ts requirePermission` → throw |
| U7 | Permission denied — DELETE | error.tsx (full page) | `actions.ts: throw new Error('No permission to delete')` |
| U8 | FK autocomplete denied (case g, before the FK-autocomplete fix) | error.tsx — page crashes | `getters.ts assertPermission` → throw (in Promise.all) |
| U9 | FK autocomplete denied (case g, after the FK-autocomplete fix) | FK field disabled, no i18n text yet | `getters.ts` returns `{ permissionDenied: true }` |
| U10 | Org isolation violation (write, form path) | error.tsx: "Organization access denied" (dev) / redacted (prod) | service.ts's org-isolation check → throw |
| U11 | Validation error — required field, form | error.tsx: "{label} is required" (dev) / redacted (prod) | `service_validation.ts` → throw → `actions.ts` re-throw |
| U12 | Validation error — OTO conflict, form | error.tsx: "{label} is already linked" (dev) / redacted (prod) | `service_validation.ts` → throw → re-throw |
| U13 | Stale update — another user edited first | error.tsx: "This record has been updated..." (dev) / redacted (prod) | `lib/normalize.ts assertNotStale` → throw |
| U14 | Record deleted between form-open and submit | error.tsx: "This record no longer exists." (dev) / redacted (prod) | `lib/normalize.ts assertNotStale` → throw |
| U15 | Reservation capacity (form path) | Inline form error, raw string | `actions.ts` catches `InsufficientPoolCapacityError` → `return { error }` |
| U16 | Reservation conflict (form path) | Inline form error, raw string | `actions.ts` catches `ReservationMutationError` → `return { error }` |
| NEW-1 | Any server-throw path (U3-U14), as observed in production before this implementation | "Minified React error #441; ..." + "Error ID: xxx" | React SC render boundary (production) |

**2026-08-14**: a real production screen confirmed that U3-U14 scenarios
appeared this way. React strips the original `error.message` at the Server Components
render boundary and replaces it with the minified error #441 text; `error.digest`
("Error ID: xxx") survives. The fix was not to add display code to `error.tsx` (it
already rendered `error.message`) but to stop throwing `AppError` from Server Actions
and return `ActionFailure` instead (Layer 2).

**Implemented (2026-08-15)**: U6/U7/U10-U14 now return inline `ActionFailure`
instead of throwing. U7 (bulk delete, `removeXxx`) was added beyond the checklist's
per-file list, since the checklist's own throw-sites table already named it and leaving
it unconverted would have left permission-denied (one of the three named types) still
crashing to `error.tsx` on the delete path. **U3-U5 are unchanged by design** —
`getters.ts`'s `assertPermission` (used by Server Component pages, not Server Actions)
still throws and still terminates at `error.tsx`; converting that path would require
redesigning the page itself (`notFound()` / conditional render), which is out of scope
here. `error.tsx` now shows a static, safe `te('pageError')` message instead of a
hardcoded string, so U3-U5 are no less safe than before — just not yet inline.

**NEW-2 (found during this implementation, not in the original checklist)**: a real
literal "Unique key constraint violation" had no throw site anywhere in this
framework — `service_validation.ts.jinja2`'s checks only cover the schema-driven
required-field and one-to-one-relation cases (`AppError('VALIDATION'|'CONFLICT', ...)`).
A genuine DB-level `@unique`/`@@unique` violation (`user.email`, `approval_flow`'s
`[entity_name, approver_role_id]`, `permission`'s `[name, role_id]`) is never
pre-checked anywhere in application code — it surfaces as a raw
`Prisma.PrismaClientKnownRequestError` (code `P2002`) thrown out of
`prisma.$transaction()` in `service.ts.jinja2`. Before this fix that error was neither
an `AppError` nor a reservation-specific class, so it fell through the new
`actions.ts` catch blocks unconverted and still crashed to `error.tsx` — reproducing
this exact symptom. Fixed by wrapping `add{{ parent_pascal }}`/`update{{ parent_pascal }}`'s
`prisma.$transaction()` call in `service.ts.jinja2` in a `try`/`catch` that converts
`P2002` to `AppError('CONFLICT', ...)` (not `VALIDATION` — the field is not missing, it
conflicts with an existing row, so it reuses the same `fieldAlreadyLinked` i18n message
as the OTO-conflict case) before it ever reaches the transport layer —
this also fixes the equivalent gap on the API route path (`lib/api-auth.ts`'s
`handleApiError` previously had no case for a raw `PrismaClientKnownRequestError`
either, so it fell to the generic 500).

The violated field name (`AppError`'s 3rd, UI-facing argument) is read via a new
`lib/_errors.ts` helper, `p2002Field(meta)` — **empirically confirmed necessary**: this
generated app's Prisma version/driver (7.9.1, Postgres driver adapter) puts the
violated column names at `e.meta.driverAdapterError.cause.constraint.fields`, not the
classic `e.meta.target` most Prisma docs/examples show. Getting this wrong doesn't
crash — it silently produces `field: undefined`, which falls back to the CONFLICT
code's field-less wording (`staleMutation`, "has been updated since you opened it") instead of the
correct field-bearing one (`fieldAlreadyLinked`, "{field} is already linked to another
record") — a wrong-but-plausible message that a code read alone would not catch. Found
only by adding a temporary diagnostic log to the generated output and running the new
`cypress/e2e/error_message_delivery.cy.ts` (§UI e2e coverage below) against it; do not
assume Prisma's error `meta` shape without checking it against the actual runtime error
for the Prisma version/driver in use.

### U1/U2 unreachable (an earlier auth-redirect fix)

**Update (2026-08-02)**: `proxy.ts` (this repo's Next.js middleware —
renamed from `middleware.ts` under Next 16) already redirects unauthenticated
requests to any protected *page* route straight to `/login`, before the page
component (and therefore `getSessionUserIdOrThrow`/`assertPermission`) ever
runs. This existed on `develop` prior to this doc being written — OQ-4 below
asked whether it should be added, without realizing it already had been (in
the earlier Cloud Run hardening work). That fix empirically confirmed via
direct HTTP requests (both unauthenticated and with a valid session cookie)
that:

- An unauthenticated request to a protected page route (e.g. `/en/dashboard`)
  receives a `307` to `/en/login?redirect=<original-path>`, never reaching
  the page.
- `/api/*` routes are excluded from `proxy.ts`'s matcher entirely and
  continue to return their own JSON `401`/`404` via `lib/api-auth.ts` —
  unaffected by this change (that keeps A1–A13 above accurate as written).
- `/login`, `/register`, `/docs`, `/legal/*`, static assets, and `_next/*`
  are excluded (`PUBLIC_PATHS` + the route matcher), so there is no redirect
  loop.
- That fix additionally added a `redirect` query param so the login page
  sends the user back to where they started (validated against open-redirect
  via `lib/auth/safe-redirect.ts` — same-origin, path-absolute values only).

**Consequence**: U1 and U2 as originally described (an unauthenticated user
reaching `error.tsx` via a thrown "User not authenticated" / empty-perms
error) cannot occur through normal browser traffic any more. `proxy.ts`'s
route matcher (`/((?!api|_next|_vercel|.*\..*).*)`) covers **every** HTTP
method on a non-`/api` page path, not just `GET` — empirically confirmed
that an unauthenticated `POST` to a page path (the shape a Server Action
submission takes) is redirected the same way a `GET` page load is, before
`actions.ts`/`authz.ts` ever runs. The rows above are struck through and
kept for historical context. The `getSessionUserIdOrThrow`/`assertPermission`
throw sites themselves are UNCHANGED and still fire correctly for
authenticated-but-unauthorized users (U3–U14 are unaffected — those users
have a valid session, so `req.auth` is truthy and `proxy.ts` lets them
through to the real permission check); they remain in place as
defense-in-depth for any future caller of these lib functions that doesn't
arrive via `proxy.ts`'s route matcher, even though no such caller exists in
this repo today.

### Key observations

- **`assertNotStale` ALREADY EXISTS** (`lib/normalize.ts:41`). It detects other-user edits via
  full-field snapshot comparison. No version column needed — the client sends `__src_snapshot` (JSON
  of entity at form-open), the server compares to current DB state inside the transaction. The
  detection is real and working; only the transport to the user is broken (throw → error.tsx instead
  of inline).

- **Prod/dev gap is the root cause** of the perception problem. In development the raw message is
  visible. In production Next.js strips it. The framework must surface user-facing information via
  `errorCode` (survives the Next.js boundary) — not via raw message text.

- **FK autocomplete denied (case g)** was the original complaint. An earlier fix addressed
  the crash (no longer throws); this framework provides the i18n keys for the disabled-field UI.

---

## Disclosure Policy

**Principle**: reveal what a legitimate user needs to take the next action; hide internal structure and
cross-org existence.

| Error class | Reveal to user? | Rationale |
|-------------|----------------|-----------|
| Missing / invalid credentials | Yes — specific auth reason | Helps user sign in |
| Session expired | Yes — "please sign in again" | Actionable |
| Permission denied (general) | Yes — "insufficient permission" | User contacts admin; exposing `model.create` leaks schema names |
| Not found (genuine) | Yes — "record not found or may have been deleted" | User knows to stop looking |
| **Org isolation violation** | **Hide — treat as Not Found** | Revealing "Organization access denied" tells the caller that the record EXISTS. The strict org isolation policy forbids even acknowledging existence of records in other orgs. POST/Service Action must match the API path (which already returns 404). |
| Validation (field-level) | Yes — "{field} is required / already linked / has an invalid or disallowed value" | User can fix and resubmit |
| Stale update | Yes — "updated since you opened it, reload" | User knows to refresh. The detection is snapshot-based (`assertNotStale` compares DB state to what the form loaded) and never determines *who* changed the record, so the wording must not claim "another user" — see "Stale-update wording must not claim 'another user'" below. |
| Reservation locked (criteria changed after allocation) | Yes — "this row's reservation has already been allocated, criteria can no longer be changed" | User understands this is a business-rule rejection, not a version conflict — carries its own `RESERVATION_LOCKED` errorCode, kept apart from `CONFLICT` (see "`CONFLICT`/no-field also covered an unrelated reservation-lock rejection" below) |
| Record deleted before submit | Yes — "no longer exists, may have been deleted" | User knows to stop editing |
| FK autocomplete denied | Yes — "no permission to view {entity}" + hint | User can request access from admin |
| Reservation-specific | Yes (current behavior, unchanged) | Domain-specific and safe |
| Internal / unexpected | No — generic "unexpected error" | No stack traces, no internal details |

### The org isolation answer

**Org isolation violations MUST surface as `NOT_FOUND`** (not `PERMISSION_DENIED`).

Current inconsistency:
- API GET/PUT/DELETE: org-scoped `findFirst` → null → `{"error":"Not found"}` ✅
- API POST + Server Action write: `throw new Error('Organization access denied')` ← WRONG ❌

The implementation must change the service.ts org membership check to throw an error that maps to
`NOT_FOUND`. See Implementation Changes below.

---

## Error Classification Taxonomy

```typescript
// lib/_errors.ts  (new write-once lib file)
export type ErrorCode =
  | 'SESSION_EXPIRED'     // unauthenticated or timed-out session
  | 'PERMISSION_DENIED'   // authenticated, but operation not allowed
  | 'NOT_FOUND'           // record absent OR org isolation (masked)
  | 'VALIDATION'          // field-level input error (missing, invalid, OTO conflict)
  | 'CONFLICT'            // stale-update (assertNotStale snapshot mismatch), field-less
  | 'RESERVATION_LOCKED'  // reservation criteria changed after allocation, field-less
  | 'CAPACITY'            // pool / inventory exhausted
  | 'UNKNOWN';            // unexpected internal error

export class AppError extends Error {
  readonly name = 'AppError';
  constructor(
    public readonly code: ErrorCode,
    message: string,           // internal debug message — never sent to UI
    public readonly field?: string,  // affected form field key (for VALIDATION)
  ) {
    super(message);
  }
}

// Discriminated union for server action return
export type ActionSuccess = { ok: true };
export type ActionFailure = { ok: false; errorCode: ErrorCode; field?: string };
export type ActionResult  = ActionSuccess | ActionFailure;
```

---

## Layer-by-Layer Design

### 1. Throw sites → `AppError`

Replace all plain `Error` throws at the named sites with typed `AppError`:

| File | Site | Current throw | New throw |
|------|------|--------------|-----------|
| `lib/authz.ts` | `getSessionUserIdOrThrow` | `Error('User not authenticated')` | `AppError('SESSION_EXPIRED', ...)` |
| `lib/normalize.ts` | `assertNotStale` — invalid snapshot | `Error('Invalid snapshot data...')` | `AppError('CONFLICT', ..., undefined)` |
| `lib/normalize.ts` | `assertNotStale` — record gone | `Error('This record no longer exists.')` | `AppError('NOT_FOUND', ..., undefined)` |
| `lib/normalize.ts` | `assertNotStale` — snapshot mismatch | `Error('This record has been updated...')` | `AppError('CONFLICT', ..., undefined)` |
| `service_validation.ts.jinja2` | required field | `Error('{label} is required')` | `AppError('VALIDATION', ..., '{key}')` |
| `service_validation.ts.jinja2` | OTO target not found | `Error('{label} does not exist')` | `AppError('VALIDATION', ..., '{key}')` |
| `service_validation.ts.jinja2` | OTO already linked | `Error('{label} is already linked')` | `AppError('CONFLICT', ..., '{key}')` |
| `service.ts.jinja2` | org membership check CREATE (org-isolation fix) | `Error('Organization access denied')` | `AppError('NOT_FOUND', 'Not found')` |
| `service.ts.jinja2` | org membership check UPDATE (org-isolation fix) | `Error('Organization access denied')` | `AppError('NOT_FOUND', 'Not found')` |
| `actions.ts.jinja2` | `removeXxx` no items after org filter | `Error('No permission to delete')` | `AppError('PERMISSION_DENIED', ...)` |

### 2. Server Action transport (`actions.ts.jinja2`)

Replace the current pattern in `upsertXxx`:

```typescript
// BEFORE (only catches reservation-specific errors)
let _serviceError: string | null = null;
try {
  await updateXxx(...);
} catch (e) {
  if (e instanceof ReservationMutationError) _serviceError = (e as Error).message;
  else throw e;
}
if (_serviceError) return { error: _serviceError };

// AFTER (catches all typed AppErrors; re-throws truly unexpected errors)
try {
  await updateXxx(...);
} catch (e) {
  if (e instanceof AppError)
    return { ok: false, errorCode: e.code, field: e.field } satisfies ActionFailure;
  if (e instanceof ReservationMutationError)
    return { ok: false, errorCode: 'RESERVATION_LOCKED' } satisfies ActionFailure;
  if (e instanceof InsufficientPoolCapacityError)
    return { ok: false, errorCode: 'CAPACITY' } satisfies ActionFailure;
  throw e;  // truly unexpected → error.tsx
}
return { ok: true };
// redirect('/parent') fires only on success (move after the try-catch)
```

Similarly `removeXxx` catches `AppError('PERMISSION_DENIED')` and returns `ActionFailure`.

### 3. Client form display (`form_upsert.tsx.jinja2`)

```typescript
const te = useTranslations('Errors');
const [actionError, setActionError] = useState<ActionFailure | null>(null);

// In handleSubmit — replace existing setError(result.error):
const result = await upsertXxx(formData);
if (result && 'ok' in result && !result.ok) {
  setActionError(result);
  return;
}
// redirect happens server-side on success

// Error message lookup (i18n only — never raw server text):
function getErrorMessage(err: ActionFailure): string {
  switch (err.errorCode) {
    case 'SESSION_EXPIRED':   return te('sessionExpired');
    case 'PERMISSION_DENIED': return te('permissionDenied');
    case 'NOT_FOUND':         return te('notFound');
    case 'VALIDATION':        return err.field
                                ? te('fieldRequired', { field: err.field })
                                : te('unknown');
    case 'CONFLICT':          return err.field
                                ? te('fieldAlreadyLinked', { field: err.field })
                                : te('staleMutation');
    case 'RESERVATION_LOCKED': return te('reservationLocked');
    case 'CAPACITY':          return te('capacityExhausted');
    default:                  return te('unknown');
  }
}
```

`FormWithChildGrid` `error` prop receives the resolved string; no change to that component needed.

### 4. API route transport (`lib/api-auth.ts handleApiError`)

```typescript
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  if (error instanceof AppError) {
    const statusMap: Record<ErrorCode, number> = {
      SESSION_EXPIRED:   401,
      PERMISSION_DENIED: 403,
      NOT_FOUND:         404,
      VALIDATION:        422,
      CONFLICT:          409,
      RESERVATION_LOCKED: 409,
      CAPACITY:          409,
      UNKNOWN:           500,
    };
    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.field ? { field: error.field } : {}) },
      { status: statusMap[error.code] ?? 500 },
    );
  }
  console.error('API error:', error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

This fixes wrong status codes (validation → 422, stale → 409, org isolation → 404) and adds
the `code` field for programmatic handling by API consumers.

### 5. FK autocomplete disabled state (integration with an earlier fix)

The `permissionDenied: true` flag added by an earlier fix on `search*Options()` return needs i18n text.
The `Errors` namespace provides:
- Disabled placeholder: `te('fkPermissionDenied', { entity: entityLabel })`
- Helper text / tooltip: `te('fkPermissionDeniedHint', { entity: entityLabel })`

The FK field rendering (from that same earlier fix) should use these keys instead of any hardcoded text.
The `Errors` namespace is the single source of truth for all user-facing error strings — that earlier
fix must consume from it, not define its own keys.

### 6. `error.tsx` improvements (lower priority)

`error.tsx` is now the last resort for truly unexpected errors only. The primary design makes most
user-facing errors inline (§3), so `error.tsx` handles only unrecoverable failures.

A minimal improvement: replace hardcoded `"Something went wrong!"` with `te('Errors.pageError')`.
This is a static key that always produces the same message regardless of error type — safe in
production since no sensitive detail is in the key's value.

A future-scope enhancement: Next.js middleware redirect to `/login` on `SESSION_EXPIRED`. Not in
this framework — design separately.

---

## i18n Key Catalog

Auto-emitted into `messages/en.json` by the generator at initialization. This namespace is
entity-agnostic — `{field}` and `{entity}` are runtime interpolation params, not per-entity keys.

```json
{
  "Errors": {
    "sessionExpired":         "Your session has expired. Please sign in again.",
    "permissionDenied":       "You do not have permission to perform this action.",
    "notFound":               "The record could not be found. It may have been deleted.",
    "fieldRequired":          "{field} is required.",
    "fieldAlreadyLinked":     "{field} is already linked to another record.",
    "staleMutation":          "This record has been updated since you opened it. Please reload to compare with the latest changes.",
    "reservationLocked":      "This row's reservation has already been allocated and its quantity or criteria can no longer be changed.",
    "invalidSnapshot":        "The form data is outdated. Please reload the page.",
    "reservationConflict":    "This action conflicts with an existing reservation.",
    "capacityExhausted":      "No capacity is available. Please try a different selection.",
    "fkPermissionDenied":     "You do not have permission to view {entity} options.",
    "fkPermissionDeniedHint": "Contact your administrator to request read access to {entity}.",
    "pageError":              "Something went wrong.",
    "tryAgain":               "Try again",
    "unknown":                "An unexpected error occurred. Please try again."
  }
}
```

`messages/ja.json` equivalents must also be provided at implementation time.

---

## Stale-Update Detection

**Assessment: the detection mechanism exists and is sufficient. Only the error transport is broken.**

`lib/normalize.ts:41` `assertNotStale` uses snapshot-based optimistic locking:

1. When a form opens for edit, the current entity state is serialized as `__src_snapshot` (FormData).
2. On submit, the snapshot is sent back to the server.
3. Inside the `$transaction`, `assertNotStale` compares the DB's current state to the expected snapshot.
4. If any field changed (by another user, another tab, or a server-side side effect of the
   entity's own update path), it throws.

This does NOT require a version column or schema change. The snapshot covers all tracked fields.

The only work needed: change `throw new Error(...)` to `throw new AppError('CONFLICT', ...)` so the
action can catch it and return `{ ok: false, errorCode: 'CONFLICT' }` → form shows `te('staleMutation')`
inline instead of crashing to `error.tsx`.

### Stale-update wording must not claim "another user"

`assertNotStale` only ever compares two snapshots — it has no way to determine *who* or *what*
changed the record between form-open and submit. It fires the same way whether the change came
from another user, another tab of the same user, or a server-side side effect of the entity's own
update path. Both the server-side `AppError` message (`lib/normalize.ts`) and the UI-facing
`staleMutation` i18n key state only the fact the mechanism can actually establish — the record
changed since it was opened — and must not say "by another user". `messages/en.json` /
`messages/ja.json` and `form_upsert.tsx.jinja2` were corrected to match this; see the
i18n Key Catalog above.

### `CONFLICT`/no-field also covered an unrelated reservation-lock rejection

Fixing the wording above was not sufficient on its own. A follow-up investigation found that the
same `errorCode: 'CONFLICT'` + no `field` combination the UI uses to select the `staleMutation`
text was reached by **two semantically unrelated causes**, not one:

1. A genuine `assertNotStale` snapshot mismatch (the case this whole section is about).
2. `updateXxx`'s reservation-mutation guard throwing `ReservationMutationError` when an update
   tries to change a row whose reservation is already allocated
   (`lib/{{ parent }}/service.ts`'s reservation guard, generated for any `x-reservation` entity).
   This guard runs and can throw *before* `assertNotStale` is ever reached — the snapshot
   comparison itself never ran in this case, yet the UI showed the exact same "record changed
   since you opened it" message.

Neither the "reload and compare" wording nor any snapshot-mismatch fix addresses cause (2):
the record was rejected because of an allocation lock, not because it changed underneath the
user. `_wrap_call_with_catch` in `code_generator/generators.py` (the generic try/catch the
generator wraps every create/update Server Action call in) mapped `ReservationMutationError` to
`errorCode: 'CONFLICT'`, the same field-less code `assertNotStale` produces — merging the two
causes onto one wire code. Fixed by giving `ReservationMutationError` its own errorCode,
`RESERVATION_LOCKED`, with its own `reservationLocked` i18n key (en/ja) and its own
`getErrorMessage` branch in `form_upsert.tsx.jinja2` — see the `ErrorCode` union and the
Server Action / client transport code samples above. This is a template-level, generator-wide
fix: it applies to every entity with `x-reservation` configured, not just one entity, since
`_wrap_call_with_catch` is the single generic wrapper used for all create/update actions.

**Lesson**: a field-less `errorCode` is a lossy signal by construction — before adding a new
throw site anywhere in the generated create/update path that can produce a field-less error,
check whether it collides with an existing field-less code (`CONFLICT` in particular) rather
than assuming each throw site maps to a distinct, already-correct user-facing message.

**Second lesson, caught by the mandatory `test:e2e:build` type-check, not by inspection**: adding
`RESERVATION_LOCKED` to the `ErrorCode` union broke `next build`'s TypeScript pass —
`lib/api-auth.ts`'s `APP_ERROR_STATUS_MAP: Record<ErrorCode, number>` is an *exhaustive* mapping
(TS2741, "Property is missing"), unlike `form_upsert.tsx.jinja2`'s `getErrorMessage` `switch`,
which has a `default` case and would have silently fallen through to `unknown` with no compiler
error at all. Any future addition to `ErrorCode` must grep for every `Record<ErrorCode, ...>` in
the repo (currently just this one map), not only the `switch` statements — the two fail
differently, and only one of them fails loud.

### `VALIDATION`/no-field also covers a whole class of "related row is wrong" rejections

A follow-up case, structurally identical to the `CONFLICT`/no-field collision above but on the
`VALIDATION` code instead. A hand-written cascade rejected a shipment header's own status update
because a *child* row (`shipment_line`) referenced by that shipment did not satisfy a precondition
(missing `inventory_id`, wrong item, or — the new rule added at the same time — not yet marked
`packed`). The rejection reached the client as `errorCode: 'VALIDATION'`, `field: undefined` —
because the throw site had no field on the *shipment* form to blame; the actual problem lives on a
different row of a different entity. `getErrorMessage`'s `VALIDATION` branch falls back to
`terr('unknown')` whenever `field` is absent, so the user saw the same generic "An unexpected
error occurred" text this whole framework exists to eliminate.

This is not a one-off: it is the general shape of any 1-to-many (or many-to-many) relationship
where an action on the parent depends on every related row satisfying some condition — a
purchasing-side receiving/QC entity checking its lines, an approval flow checking its requests,
any parent/children pair with a business rule like "all children must be X before the parent can
become Y". Each such site would otherwise either invent its own ad hoc errorCode (multiplying
one-off codes without a shared UI branch) or fall into the same `VALIDATION`/no-field bucket as
ordinary required-field errors, which is what happened here.

Fixed the same way as `RESERVATION_LOCKED`: a new field-less code, `RELATED_RECORD_INVALID`, with
its own `relatedRecordInvalid` i18n key (en/ja) and its own `getErrorMessage` branch in
`form_upsert.tsx.jinja2`. Unlike `RESERVATION_LOCKED` (which is tied to one specific generated
mechanism, `x-reservation`), this code is intentionally generic — any hand-written
`service_validation_custom.ts` or cascade file, for any entity, that rejects an action because a
related row fails a condition should throw `AppError('RELATED_RECORD_INVALID', ...)` rather than
inventing a new code or falling back to field-less `VALIDATION`.

**What this does NOT fix**: even with the distinct errorCode, the message shown is still generic —
"a related record does not meet the required condition" says nothing about *which* row, *which*
entity, or *what* condition. That is a harder, still-open problem: the parent form's error display
has no vocabulary for "go look at row 3 of a different entity's list" — see the open question below.

---

## Impact on Existing Specs

| Impact area | Current behavior | After framework | Spec change needed |
|-------------|-----------------|-----------------|-------------------|
| API e2e: validation error status | 500 | 422 | No pre-existing spec asserted the old 500 (grepped generated `test_api_spec.cy.ts.jinja2` and all `cypress/e2e/api/*.cy.ts`, as part of this implementation) |
| API e2e: stale update (API path passes `null` — not triggered) | N/A | N/A | No |
| API e2e: permission denied status | 403 ✅ | 403 ✅ (unchanged) | No |
| API e2e: unique constraint violation (P2002) | 500 (generic fallback) | 409 (`AppError('CONFLICT', ...)`) | No pre-existing spec asserted the old 500 |
| UI e2e: validation error flow | Rarely reaches server (client `validateForm` catches first) | Same | None |
| UI e2e: stale update | Hard to trigger in e2e | Inline error instead of `error.tsx` | Done — `cypress/e2e/error_message_delivery.cy.ts` test 2 |
| UI e2e: unique constraint violation | Crashed to `error.tsx` | Inline error instead | Done — same spec, test 1 |
| UI e2e: permission denied (delete) | Crashed to `error.tsx` | Inline error + optimistic-removal rollback | Done — same spec, test 3 |
| UI e2e: FK autocomplete denied (earlier fix) | Not yet specced | Disabled field with i18n text | Out of scope for this implementation — that earlier fix's own task |

Client-side `validateForm` catches required-field errors before the server call. Server-side
validation is a backend defense rarely triggered by normal usage. Impact on existing specs is low
— confirmed by the full mandatory gate (`test:e2e:cy:api`, 240/240 passing, 0 skipped) staying
green with no assertion changes needed anywhere in the repo.

**New hand-written UI e2e coverage**: `cypress/e2e/error_message_delivery.cy.ts` exercises
the three scenarios named literally end-to-end through the browser (unique constraint violation,
stale update, permission denied), asserting the inline message renders and the page never falls
through to `error.tsx`. All three pass against a full production build. One test (permission
denied) needed a 31s wait to clear `lib/authz.ts`'s 30s `getModelPermissions` process cache —
see that test's own comment for what was tried and why a wait, not a targeted cache-bust, was
the reliable option found.

---

## `submit_for_approval.ts.jinja2` joined this framework

The explicit "(re)submit" Server Action (`submit_for_approval.ts.jinja2`,
generated as `lib/{parent}/submit_actions.ts` — the standalone path for
`x-approval.submit_on`, used unconditionally whenever the entity has that
config, and the *only* path for an `edit: false` entity, which has no PUT
route at all) was never wired into this framework. It declared `Promise<void>`
and let every failure — including the reservation-specific
`InsufficientPoolCapacityError` — throw straight across the `'use server'`
boundary. Separately, its one caller (`components/_standard/ApprovalSection.tsx`'s
Submit button) invoked it inside `startTransition(() => { onSubmitForApproval(); })`
with no `await`, no pending-state tracking, and no result handling — so even
a correctly-returned failure had nowhere to go. Two independent gaps, on
either side of the same call, both had to close for either fix to be
observable.

**The fix**:

- `submit_for_approval.ts.jinja2` now wraps its `prisma.$transaction()` call
  in the same shape `_wrap_call_with_catch` already produces for
  `upsertXxx`/`removeXxx`: catch `AppError` → `ActionFailure` with the
  thrown error's own `code`/`field`/`reason`; catch the reservation-specific
  `InsufficientPoolCapacityError` (only emitted when the entity's own
  `reservation_error_import_model` context var is set) → `CAPACITY`. Returns
  `Promise<ActionFailure | void>`.
- **Deliberate divergence from `_wrap_call_with_catch`**: that helper
  re-throws anything it doesn't recognize, so an unexpected error still
  crashes to `error.tsx` for `upsertXxx`/`removeXxx`. This entity's version
  does **not** re-throw — any other caught value falls back to the
  field-less `UNKNOWN` code (already in the `ErrorCode` union and the
  Disclosure Policy table above: "Internal / unexpected → generic message,
  no stack traces, no internal detail") instead of propagating. This was a
  requirement, verified by an acceptance test (see below), not a judgment
  call: a genuinely new exception type appearing anywhere in this
  transaction (a hand-written `service_after_submit.ts` hook,
  `service_validation_custom.ts`, a future Prisma error shape) must be
  visible to the user without ever requiring a template/generator change —
  the alternative (naming each exception type in a `catch` here) is exactly
  the per-exception-dispatch shape this framework's Disclosure Policy
  already rejects for "Internal / unexpected".
- `components/_standard/ApprovalSection.tsx`'s `handleSubmitForApproval`
  now `await`s the action inside its own `useTransition` (kept separate
  from the pre-existing approve/reject/withdraw transition, which this fix
  does not touch), disables the Submit button while pending, and — on
  failure — displays the message inline via a new shared
  `getErrorMessage(err, terr)` helper added to `lib/_errors.ts`. That
  helper is the exact same `errorCode → i18n key` mapping
  `form_upsert.tsx.jinja2` already generates inline per entity, factored
  out so a hand-written (non-generated) caller can reuse it instead of
  duplicating the switch. `form_upsert.tsx.jinja2` itself was not changed —
  its own inline copy still works and touching a template with this much
  existing golden-diff/gate coverage for a pure refactor was not worth the
  risk.
- **Found and fixed as a side effect, not the main fix**: wrapping the
  Submit `Button` in a `<span>` (the standard MUI pattern for a `Tooltip`
  whose child can become `disabled` — a disabled element fires no pointer
  events, so `Tooltip` can't attach its hover listeners directly) combined
  with the `Button`'s own explicit `aria-label` produced **two** DOM
  elements both answering to the same accessible name: `Tooltip` clones an
  `aria-label` from its `title` prop onto its immediate child whenever that
  child has none of its own, and the immediate child was now the `<span>`,
  not the `Button`. `components/_standard/ApprovalSection.test.tsx`'s
  existing `getByLabelText('submit')` caught this immediately (two
  matches). Fixed by dropping the now-redundant `aria-label` from the
  `Button` — its own visible text (`{t('submit')}`) already supplies its
  accessible name, so only the `span` carries one now. Worth remembering
  for any future `Tooltip` + conditionally-`disabled`-child pattern in this
  codebase: giving the interactive child its own `aria-label` *and* letting
  `Tooltip` wrap it in a `<span>` will silently create two elements with
  the same name.

**Acceptance test performed (not committed — the throwaway exception this
required is exactly what the design must never need again)**: a one-off
`class` extending `Error`, never seen by this generator, was thrown from a
scratch consumer's `service_after_submit.ts` hook for its `inventory_reservation`
entity (an `x-approval` + `x-reservation` + `edit: false` entity — the
generator's own dogfood schema declares no `x-approval` entity at all, so
this had to be verified against a real consumer schema in an isolated,
disposable worktree, discarded after use — no schema/entity addition or
generated output from this verification was committed anywhere). With zero
changes to any template or to `generators.py`, the submit correctly showed
the generic `unknown` message inline, `error.tsx` was never reached, and
the record's status rolled back — confirming the catch-all needs no
maintenance as new exception types appear anywhere in this transaction.
The exception was removed immediately after.

**Known gap, left open**: this generator's own dogfood schema
(`code_generator/json_schema.yaml`) declares zero `x-approval` entities, so
there is nowhere in this repo's own committed Cypress suite to attach a
permanent UI e2e regression test for this exact mechanism (matching this
doc's own "New hand-written UI e2e coverage" precedent above, which relies
on `approval_flow`/`user` — plain CRUD entities, not `x-approval` ones).
Verification for this change relied on a real consumer's schema
(`inventory_reservation`) in an isolated, discarded worktree instead — real
end-to-end coverage (screenshots of the reported capacity-exhausted
scenario resolving inline, `tsc --noEmit` clean, full consumer build clean,
zero unrelated entities' generated output changed) but not a regression
test that runs on every future change to this template. Whoever revisits
`submit_for_approval.ts.jinja2` next should either add a minimal
`x-approval` dogfood entity to this schema (a real design decision, not
made here) or accept that this path's regression coverage lives in
individual consumer repos.

---

## Implementation Checklist (for implementation cmd)

1. `lib/_errors.ts` — create `AppError` class and `ErrorCode` / `ActionResult` types (write-once)
2. `lib/authz.ts` — `getSessionUserIdOrThrow` throws `AppError('SESSION_EXPIRED', ...)`
3. `lib/normalize.ts` — `assertNotStale` throws `AppError('CONFLICT' | 'NOT_FOUND', ...)`
4. `lib/api-auth.ts` — `handleApiError` handles `AppError` with correct status codes
5. `messages/en.json` — add `Errors` namespace (and `messages/ja.json` equivalent)
6. `service_validation.ts.jinja2` — throw `AppError('VALIDATION' | 'CONFLICT', ..., field)`
7. `service.ts.jinja2` — org membership check throws `AppError('NOT_FOUND', 'Not found')` replacing
   the current "Organization access denied" string (org isolation disclosure fix; matches API path)
8. `actions.ts.jinja2` — `upsertXxx` and `removeXxx` catch `AppError` → return `ActionFailure`
9. `form_upsert.tsx.jinja2` — read `errorCode` from result, display via `te('Errors.*')` keys
10. `types.ts.jinja2` — export `ActionResult` type (or import from `lib/_errors`)
11. Integration with an earlier FK-autocomplete fix — FK disabled state uses `Errors.fkPermissionDenied` / `fkPermissionDeniedHint`
12. `error.tsx` — replace hardcoded strings with i18n keys (optional, lower-priority)

Steps 1–5 are write-once lib / config changes. Steps 6–12 are generator template changes.

---

## Open Questions

| ID | Question |
|----|----------|
| OQ-1 | **Org isolation masking**: Confirm `NOT_FOUND` is correct for org isolation violations — the earlier org-isolation fix's "Organization access denied" text would be replaced by "Not found" to match the API path and avoid leaking cross-org existence. |
| OQ-2 | **`staleMutation` message**: "reload to compare with the latest changes" causes the user to lose form edits. Should the UI preserve or diff the form state instead? Out of scope here, but worth tracking. |
| OQ-3 | **Japanese i18n keys**: Who authors `messages/ja.json` equivalents for the `Errors` namespace? Standard pattern: generator emits English; consumer provides Japanese. |
| OQ-4 | ~~**error.tsx session-redirect**: Should Next.js middleware redirect unauthenticated requests to `/login` before the page renders? This would eliminate U1/U2 scenarios entirely. Separate design issue.~~ **Resolved (an earlier auth-redirect fix)**: it already did, on `develop`, before this question was written — see "U1/U2 unreachable (an earlier auth-redirect fix)" above. That same fix additionally closed the one gap that existed (no return-to-original-page behavior) by adding a validated `?redirect=` round trip through `lib/auth/safe-redirect.ts`. |
| OQ-5 | **A parent form has no vocabulary to point at a child row's field.** Giving a related-record rejection its own errorCode (`RELATED_RECORD_INVALID`, see the case study above) only fixes *which generic sentence* is shown — it does not fix the sentence's lack of specificity. The deeper gap: `ActionFailure.field` names a field on the form that submitted the action, but the actual defect can live on a *different entity's row* that the current form has no way to display or link to (e.g. a shipment header's status update fails because shipment_line #3 is not packed — the shipment edit form has no "line #3" or "packed" field of its own to attach an error to, and adding `field: 'status'` on the *child* entity wouldn't help either, since the child isn't the form currently open). Adding a bare `field` string is not enough to close this — it would need to identify the row (which entity, which id or row index) as well as the field, and the display layer would need new logic to render that as a usable pointer ("go check shipment_line #3") rather than plain text. No design for this exists yet. Recommendation for whoever picks this up: treat it as a generator-wide, cross-entity feature (like the errorCode itself), not a one-off fix for shipment; survey which other entities have the same parent-depends-on-children shape before designing the fix, since a design that only covers shipment would likely need redoing for the next entity that hits this. |
