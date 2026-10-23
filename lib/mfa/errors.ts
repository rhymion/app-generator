/** Thrown by `verifyMfaCode` when the per-user second-factor budget is spent. */
export class MfaRateLimitedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super('Too many MFA attempts');
    this.name = 'MfaRateLimitedError';
  }
}
