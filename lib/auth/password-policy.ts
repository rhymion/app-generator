/**
 * Minimum password strength (Issue #1125, ASVS V6.2.1). One rule shared by
 * registration, the settings password form and the REST/bulk credential
 * change, so no path can set a weaker password than another. Length is the
 * only rule: ASVS V6.2.5 forbids composition requirements, and the maximum
 * length, common-password and breached-password checks belong to #1280.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Returns an error message when `password` is too weak, otherwise null. */
export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  return null;
}
