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
code's field-less wording (`staleMutation`, "updated by another user") instead of the
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
| Validation (field-level) | Yes — "{field} is required / already linked" | User can fix and resubmit |
| Stale update | Yes — "updated by another user, reload" | User knows to refresh |
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
  | 'CONFLICT'            // stale-update or reservation conflict
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
    return { ok: false, errorCode: 'CONFLICT' } satisfies ActionFailure;
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
    "staleMutation":          "This record was updated by another user. Please reload the page and try again.",
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

## "Other User's Update" Detection

**Assessment: the detection mechanism exists and is sufficient. Only the error transport is broken.**

`lib/normalize.ts:41` `assertNotStale` uses snapshot-based optimistic locking:

1. When a form opens for edit, the current entity state is serialized as `__src_snapshot` (FormData).
2. On submit, the snapshot is sent back to the server.
3. Inside the `$transaction`, `assertNotStale` compares the DB's current state to the expected snapshot.
4. If any field changed (by another user or another tab), it throws.

This does NOT require a version column or schema change. The snapshot covers all tracked fields.

The only work needed: change `throw new Error(...)` to `throw new AppError('CONFLICT', ...)` so the
action can catch it and return `{ ok: false, errorCode: 'CONFLICT' }` → form shows `te('staleMutation')`
inline instead of crashing to `error.tsx`.

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
| OQ-2 | **`staleMutation` message**: "reload the page and try again" causes the user to lose form edits. Should the UI preserve or diff the form state instead? Out of scope here, but worth tracking. |
| OQ-3 | **Japanese i18n keys**: Who authors `messages/ja.json` equivalents for the `Errors` namespace? Standard pattern: generator emits English; consumer provides Japanese. |
| OQ-4 | ~~**error.tsx session-redirect**: Should Next.js middleware redirect unauthenticated requests to `/login` before the page renders? This would eliminate U1/U2 scenarios entirely. Separate design issue.~~ **Resolved (an earlier auth-redirect fix)**: it already did, on `develop`, before this question was written — see "U1/U2 unreachable (an earlier auth-redirect fix)" above. That same fix additionally closed the one gap that existed (no return-to-original-page behavior) by adding a validated `?redirect=` round trip through `lib/auth/safe-redirect.ts`. |
