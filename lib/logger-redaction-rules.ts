// Redaction rules for lib/logger.ts, kept as plain data so extending them is a one-line change.
// Nothing here executes; lib/logger.ts is the only consumer.

/**
 * Object keys are normalized before matching: lower-cased with every character that is not a letter or
 * digit removed, so `x-api-key`, `X_API_KEY` and `xApiKey` all become `xapikey`.
 */

/** A key is redacted when its normalized form contains any of these fragments. */
export const REDACTED_KEY_FRAGMENTS: readonly string[] = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'privatekey',
  'accesskey',
  'credential',
  'signature',
  'sessionid',
  'csrf',
];

/**
 * A key is also redacted when its normalized form equals one of these. They are too short to match as
 * fragments (`key` would hit `keyboard`, `pin` would hit `shipping`).
 */
export const REDACTED_KEY_EXACT: readonly string[] = ['key', 'pwd', 'auth', 'pin', 'otp', 'jwt', 'session'];

/** String values are scanned for these patterns; every match is replaced by the label. */
export const REDACTED_VALUE_PATTERNS: readonly { label: string; source: string; flags: string }[] = [
  // An email address.
  { label: '[REDACTED:email]', source: "[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+", flags: 'g' },
  // An `Authorization` header value that was logged inside a longer string.
  { label: 'Bearer [REDACTED]', source: 'Bearer\\s+[A-Za-z0-9._~+/-]+=*', flags: 'gi' },
  // A JSON Web Token (three base64url segments, the first two starting with `eyJ`).
  { label: '[REDACTED:jwt]', source: 'eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+', flags: 'g' },
];

/** What replaces the value of a redacted key. */
export const REDACTED_PLACEHOLDER = '[REDACTED]';

/** Nesting deeper than this is replaced by `[Truncated]` so a hostile or cyclic structure cannot cost unbounded work. */
export const MAX_REDACTION_DEPTH = 8;
