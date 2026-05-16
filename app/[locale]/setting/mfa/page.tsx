import { getSessionUserIdOrThrow } from '@/lib/authz';
import { getEnrollmentStatus } from '@/lib/mfa/enrollment';

import MfaClient from './mfa-client';

// Server component: fetches the current enrollment state once on each
// navigation, then hands off to the client component for the interactive
// state machine. After a successful server action call the client
// triggers a `router.refresh()` so this re-renders with the new state
// (revalidatePath in the action does the cache invalidation).
export default async function MfaSettingsPage() {
  const userId = await getSessionUserIdOrThrow();
  const status = await getEnrollmentStatus(userId);
  return <MfaClient initial={status} />;
}
