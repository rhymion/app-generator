/**
 * Required MFA enrolment for selected roles (Issue #1281, ASVS V6.3.3).
 *
 * `MFA_REQUIRED_ROLES` names the roles whose members must enrol in MFA:
 *
 *   - unset or empty: nobody is required (MFA stays opt-in; the default);
 *   - `*`: every user;
 *   - a comma-separated list of role names (`role.name`, exact, case-sensitive),
 *     e.g. `Admin,Approver`: a user holding at least one of them.
 *
 * A required user who has not enrolled keeps a valid sign-in, whatever the
 * sign-in method (password or OAuth), but the session is restricted: `auth.ts`
 * marks it `mfa_enrollment_required`, `proxy.ts` sends every page to
 * `/setting/mfa`, and `getSessionUserId()` (lib/authz.ts) answers null for it,
 * so no Server Action or cookie-authenticated route acts for that user. Only the
 * MFA settings page and its actions read the user through
 * `getSessionUserIdForMfaSetup()`. Enrolling lifts the restriction on the next
 * request. API-key and mobile-token callers are not affected.
 *
 * See docs/knowledge/authentication.md ("Required MFA").
 */
import prisma from '@/lib/prisma';

export type MfaRequiredPolicy = { all: boolean; roles: ReadonlySet<string> };

/** The page a user who must enrol is sent to; its Server Actions post to the same path. */
export const MFA_SETUP_PATH = '/setting/mfa';

/**
 * Whether a page (path without the locale prefix) stays reachable for a session
 * restricted by required enrolment: the MFA settings page and the MFA challenge
 * (shown right after enrolling, when the new factor is first asked for).
 */
export function isPathAllowedWhileEnrollmentRequired(pathWithoutLocale: string): boolean {
  return [MFA_SETUP_PATH, '/mfa-challenge'].some(
    (p) => pathWithoutLocale === p || pathWithoutLocale.startsWith(`${p}/`),
  );
}

export function parseMfaRequiredRoles(raw: string | undefined): MfaRequiredPolicy {
  const names = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return { all: names.includes('*'), roles: new Set(names.filter((n) => n !== '*')) };
}

export function mfaRequiredPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): MfaRequiredPolicy {
  return parseMfaRequiredRoles(env.MFA_REQUIRED_ROLES);
}

export function isPolicyActive(policy: MfaRequiredPolicy): boolean {
  return policy.all || policy.roles.size > 0;
}

type RoleClient = {
  user: {
    findUnique: (args: {
      where: { id: string };
      select: { roles: { select: { name: true } } };
    }) => Promise<{ roles: { name: string }[] } | null>;
  };
};

/**
 * True when `userId` must enrol and has not. `mfaEnabled` is the caller's
 * already-read `user.mfa_enabled`, so an enrolled user costs no query and the
 * role lookup runs only for a user who is not enrolled while the policy is on.
 */
export async function isMfaEnrollmentRequired(
  userId: string,
  mfaEnabled: boolean,
  policy: MfaRequiredPolicy = mfaRequiredPolicyFromEnv(),
  client: RoleClient = prisma as unknown as RoleClient,
): Promise<boolean> {
  if (mfaEnabled || !isPolicyActive(policy)) return false;
  if (policy.all) return true;
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { name: true } } },
  });
  return (user?.roles ?? []).some((r) => policy.roles.has(r.name));
}
