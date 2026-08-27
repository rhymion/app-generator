// Write-once (not regenerated). Shared error taxonomy for the Server
// Action / API route transport described in docs/knowledge/error-message-framework.md.
//
// React strips `error.message` from any exception that crosses the Server
// Components render boundary in a production build ("Minified React error
// #441"). AppError instances are never thrown across that boundary — they
// are caught at the transport layer (actions.ts / api-auth.ts) and
// converted into a plain data value (ActionFailure / JSON body) instead,
// which survives production untouched.
export type ErrorCode =
  | 'SESSION_EXPIRED'     // unauthenticated or timed-out session
  | 'PERMISSION_DENIED'   // authenticated, but operation not allowed
  | 'NOT_FOUND'           // record absent OR org isolation / self-only ownership (masked)
  | 'VALIDATION'          // field-level input error (missing, invalid, OTO conflict)
  | 'CONFLICT'            // stale-update (assertNotStale snapshot mismatch)
  | 'RESERVATION_LOCKED'  // reservation criteria changed after allocation (ReservationMutationError) — see cmd_849
  | 'CAPACITY'            // pool / inventory exhausted
  | 'UNKNOWN';            // unexpected internal error

// VALIDATION carries two structurally different failure shapes that must
// not render as the same user-facing text (cmd_830): 'missing' means the
// field genuinely has no value (the generated REQUIRED_FIELDS check);
// 'invalid' means a value IS present but is rejected — wrong format
// (DECIMAL_FIELDS), a dangling FK (ONE_TO_ONE_RELATIONS "does not exist"),
// a locked field, or a hand-written service_validation_custom.ts business
// rule (e.g. "Insured Party is not a party on the claimed policy"). Before
// this field existed, both cases carried only `code: 'VALIDATION'` and the
// Server Action transport (getErrorMessage in form_upsert.tsx.jinja2)
// necessarily collapsed them to the same generic "{field} is required."
// wording, making a rejected-but-present value indistinguishable from an
// omitted one. Unused for every other ErrorCode.
export type ValidationReason = 'missing' | 'invalid';

export class AppError extends Error {
  readonly name = 'AppError';
  constructor(
    public readonly code: ErrorCode,
    message: string,                 // internal debug message — never sent to the UI verbatim
    public readonly field?: string,  // affected form field key (for VALIDATION / CONFLICT)
    public readonly reason?: ValidationReason,  // VALIDATION only — see ValidationReason
  ) {
    super(message);
  }
}

// Discriminated union for server action return values.
export type ActionSuccess = { ok: true };
export type ActionFailure = { ok: false; errorCode: ErrorCode; field?: string; reason?: ValidationReason };
export type ActionResult = ActionSuccess | ActionFailure;

// Extracts the violated column name from a Prisma P2002 error's `meta`
// object. Prisma's shape for this has changed across versions/drivers —
// classic `{ target: string[] }` vs. the driver-adapter shape seen with
// Prisma 7's Postgres adapter (`{ driverAdapterError: { cause: { constraint:
// { fields: string[] } } } }`, empirically confirmed 2026-08-15, cmd_695).
// Checked in that order; returns undefined (not "the first key found") if
// neither shape matches, so a field-less CONFLICT falls back to the generic
// staleMutation wording instead of showing a wrong field name.
export function p2002Field(meta: unknown): string | undefined {
  const m = meta as {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
  } | null | undefined;
  if (Array.isArray(m?.target) && m.target.length > 0) return String(m.target[0]);
  const adapterFields = m?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(adapterFields) && adapterFields.length > 0) return String(adapterFields[0]);
  return undefined;
}

// i18n key (under the 'Errors' next-intl namespace) for a field-less
// ActionFailure — used by list-level actions (bulk delete) that have no
// form field to attach the message to. Callers with a `field` (form
// validation/conflict) resolve their own key, since that needs the field
// name interpolated (see form_upsert.tsx.jinja2 getErrorMessage).
export function errorMessageKey(code: ErrorCode): string {
  switch (code) {
    case 'SESSION_EXPIRED':   return 'sessionExpired';
    case 'PERMISSION_DENIED': return 'permissionDenied';
    case 'NOT_FOUND':         return 'notFound';
    case 'CONFLICT':          return 'staleMutation';
    case 'RESERVATION_LOCKED': return 'reservationLocked';
    case 'CAPACITY':          return 'capacityExhausted';
    default:                  return 'unknown';
  }
}
