// Stand-in for @/lib/logger (webhook_signature.test.ts only): the real logger
// pulls in the app's runtime configuration, which this fixture does not have.
export const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
