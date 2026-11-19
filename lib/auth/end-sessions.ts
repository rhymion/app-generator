/**
 * Ending the other sessions on a credential change (docs/knowledge/authentication.md "Ending the
 * other sessions on a credential change"). A changed password, email address or MFA state ends
 * every web and mobile session of the user except the one that made the change, so a session
 * opened by someone who knew the old credential does not outlive it.
 */
import { recordAuditEvent } from '@/lib/audit-log';
import { currentSessionRef } from './current-session';
import { endOtherSessions } from './web-session';

/** Ends every session of `userId` but the one that sent this request, and audits how many ended. */
export async function endSessionsAfterChange(userId: string): Promise<void> {
  const ended = await endOtherSessions(userId, await currentSessionRef(userId));
  await recordAuditEvent({
    action: 'auth:sessions.endOthers',
    actor_user_id: userId,
    target_table: 'user',
    target_id: userId,
    metadata: { web: ended.web, mobile: ended.mobile },
  });
}
