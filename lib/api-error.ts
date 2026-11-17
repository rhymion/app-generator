/**
 * An error a REST route answers with its own HTTP status and message
 * (handleApiError in lib/api-auth.ts). Kept in a module with no imports so
 * lib/security-event.ts can recognise it without loading the authentication
 * code (and the database client) that lib/api-auth.ts pulls in.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
