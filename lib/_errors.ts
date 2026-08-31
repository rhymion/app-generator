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

// Extracts a violated-column label from a Prisma P2002 error's `meta`
// object. Prisma's shape for this is undocumented and has changed across
// versions/drivers at least twice now:
//   1. classic `{ target: string[] }` (older query-engine path).
//   2. the driver-adapter shape seen with Prisma 7.9.1's Postgres adapter,
//      `{ driverAdapterError: { cause: { constraint: { fields: string[] } } },
//      modelName } }` (empirically confirmed 2026-08-15).
//   3. Prisma 7.10.0's Postgres adapter DROPPED `constraint.fields` entirely
//      and now reports only `{ driverAdapterError: { cause: { constraint:
//      { index: string } }, modelName } }` — `index` is the raw Postgres
//      constraint/index name (e.g. `approval_flow_entity_name_approver_
//      role_id_key`), not a column list (empirically confirmed 2026-08-31
//      against a live Postgres test database running Prisma 7.10.0). This
//      is Postgres protocol behavior, not a Prisma choice: SQLSTATE 23505
//      (unique_violation) only ever carries a constraint *name* on the
//      wire, never the individual column names — Prisma 7.9.1's
//      `constraint.fields` was itself Prisma synthesizing that list from
//      schema metadata, and 7.10.0 simply stopped doing so.
// Checked in that order; branch 3 strips Prisma's own default constraint-
// naming affixes (`${modelName}_` prefix, `_key` suffix) to recover a
// label. For a single-column `@@unique` (the common case) this yields the
// exact original field name. For a compound `@@unique([a, b])` it yields
// the underscore-joined `a_b` (no reliable way to split that back into
// individual column names without either an extra DB catalog round-trip or
// generator-time schema metadata threaded through the call site — out of
// scope for this write-once, entity-agnostic helper) — still a truthful,
// useful label, just not perfectly one column. Returns undefined only if
// none of the three shapes match at all, so a field-less CONFLICT falls
// back to the generic staleMutation wording instead of showing a
// wrong/empty field name.
export function p2002Field(meta: unknown): string | undefined {
  const m = meta as {
    target?: unknown;
    modelName?: unknown;
    driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
  } | null | undefined;
  if (Array.isArray(m?.target) && m.target.length > 0) return String(m.target[0]);
  const adapterFields = m?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(adapterFields) && adapterFields.length > 0) return String(adapterFields[0]);
  const indexName = m?.driverAdapterError?.cause?.constraint?.index;
  if (typeof indexName === 'string' && indexName.length > 0) {
    let label = indexName;
    if (typeof m?.modelName === 'string' && m.modelName.length > 0 && label.startsWith(`${m.modelName}_`)) {
      label = label.slice(m.modelName.length + 1);
    }
    label = label.replace(/_key$/, '');
    if (label.length > 0) return label;
  }
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
