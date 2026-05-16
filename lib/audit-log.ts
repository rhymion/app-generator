/**
 * Audit log writer.
 *
 * Append-only record of security-relevant events: auth lifecycle (sign-in,
 * sign-out, account creation, rejected sign-in) and CRUD on protected
 * entities (roles, permissions, role assignments, …). The `audit_log` Prisma
 * model lives in `prisma/schema.prisma`.
 *
 * Design points:
 *
 *   - **Best-effort.** A failure to write the audit row must never abort the
 *     primary action. Callers from inside a Prisma `$transaction` pass the
 *     transaction client so the row enrolls in that transaction; everyone
 *     else uses the top-level prisma client and we swallow errors with a
 *     `console.warn` so the request continues. The trade-off: a DB hiccup
 *     can drop audit rows. That's the right call for auth events (we'd
 *     rather let the user in than 500), and for service-layer events the
 *     transactional path keeps audit + primary action consistent.
 *
 *   - **Action vocabulary.** Free-form `action` string with a documented
 *     convention: `"<surface>:<verb>"`. Surfaces in use today:
 *
 *       auth:signIn, auth:signOut, auth:signIn.reject, auth:createUser
 *       <entity>:create, <entity>:update, <entity>:delete
 *
 *     New surfaces should follow the same pattern so query filters stay
 *     ergonomic.
 *
 *   - **No FK on `actor_user_id`.** The audit row must outlive the user it
 *     references. `actor_user_id` is also nullable — some auth-side events
 *     (rejected sign-in with an unknown email) have no resolved actor.
 */
import prisma from '@/lib/prisma';

/**
 * Transaction client passed by callers from inside `prisma.$transaction`.
 * Typed as `unknown` for the same reason `service_validation.ts` does it:
 * the generated service layer uses `Pick<typeof prisma, '<model>'>` for `tx`,
 * and that narrow type does not include `audit_log`. We cast internally rather
 * than coupling this helper to the generated `TransactionClient` shape.
 */
type TxLike = unknown;

export type AuditEvent = {
  /** Stable identifier for the event surface + verb. See module docs. */
  action: string;
  /** Resolved user id when known. Use `null` for unauthenticated / unknown actors. */
  actor_user_id?: string | null;
  /** Snake_case Prisma model name when the event targets a specific row. */
  target_table?: string | null;
  /** Id of the row this event applies to (when relevant). */
  target_id?: string | null;
  /**
   * Free-form structured payload (provider name, rejection reason, before/after
   * snapshots, …). Use sparingly — large blobs make the table expensive to
   * scan. Anything PII-sensitive should be omitted or hashed.
   */
  metadata?: Record<string, unknown> | null;
  /**
   * Optional transaction client. Pass this when the caller is already inside
   * a `prisma.$transaction(async (tx) => …)` so the audit insert participates
   * in the same atomic write.
   */
  tx?: TxLike;
};

type AuditLogClient = { audit_log: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } };

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  const client = (event.tx ?? prisma) as unknown as AuditLogClient;
  try {
    await client.audit_log.create({
      data: {
        action: event.action,
        actor_user_id: event.actor_user_id ?? null,
        target_table: event.target_table ?? null,
        target_id: event.target_id ?? null,
        metadata: event.metadata ?? null,
      },
    });
  } catch (err) {
    // Outside a transaction: log and continue. Inside a transaction the
    // caller has already opted into "audit must succeed" by passing `tx`,
    // and we still want the error visible — rethrow so the transaction
    // rolls back.
    if (event.tx) throw err;
    console.warn(
      '[audit_log:write_failed]',
      JSON.stringify({
        at: new Date().toISOString(),
        action: event.action,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
