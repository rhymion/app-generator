/**
 * x-self-only admin bypass gate.
 *
 * x-self-only entities restrict every row to its creator; no permission
 * setting can widen that filter. An entity may opt into `admin_bypass`,
 * letting a designated privileged role read across all rows — but only
 * when that access is captured in the audit log first. The two are
 * inseparable by design: if the audit row cannot be written, the bypass
 * is denied and the caller falls back to the ordinary creator-restricted
 * view. There is no path that grants the wider access without a
 * corresponding audit row.
 */
import prisma from '@/lib/prisma';
import { recordAuditEvent } from '@/lib/audit-log';

const PRIVILEGED_ROLE_NAME = 'Administrator';

/**
 * Returns true only if `actorUserId` holds the privileged role AND the
 * audit write for this access attempt succeeded. Any other outcome
 * (not privileged, or the audit write throws) returns false — the
 * fail-closed default is "no bypass".
 */
export async function trySelfOnlyAdminBypass(entity: string, actorUserId: string): Promise<boolean> {
  const privilegedRoleCount = await prisma.role.count({
    where: { name: PRIVILEGED_ROLE_NAME, users: { some: { id: actorUserId } } },
  });
  if (privilegedRoleCount === 0) return false;

  try {
    // `tx: prisma` is not really a transaction client here — it's passed
    // purely to opt into recordAuditEvent's non-swallowing failure path.
    // Without a tx, a write failure is logged and swallowed so the
    // caller can't tell it happened; the self-only bypass must be able
    // to tell, since a swallowed failure would silently grant bypass
    // with no audit trail.
    await recordAuditEvent({
      action: 'self_only:admin_bypass',
      actor_user_id: actorUserId,
      target_table: entity,
      tx: prisma,
    });
    return true;
  } catch (err) {
    console.warn(
      '[self_only:admin_bypass_denied]',
      JSON.stringify({
        at: new Date().toISOString(),
        entity,
        actor_user_id: actorUserId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return false;
  }
}
