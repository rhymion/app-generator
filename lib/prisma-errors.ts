/**
 * Shared conversion of low-level Prisma errors into safe, user-facing
 * errors for delete mutations. Every generated `delete{Entity}()` in
 * `service.ts.jinja2` (both web server actions and API routes route through
 * it) funnels its Prisma call through `throwFriendlyDeleteError()` on
 * failure, so a foreign-key-restricted delete never lets Prisma's raw
 * message — which includes constraint names, model/field names, and (in
 * dev) local source file paths — reach the client (cmd_375).
 */
import { Prisma } from '@/app/generated/prisma/client';

export class RecordInUseError extends Error {
  constructor(message = 'This record cannot be deleted because other records still reference it.') {
    super(message);
    this.name = 'RecordInUseError';
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

/** Rethrows `error` as a `RecordInUseError` if it's a Prisma FK-constraint
 * violation (P2003), otherwise rethrows it unchanged. */
export function throwFriendlyDeleteError(error: unknown): never {
  if (isForeignKeyViolation(error)) {
    throw new RecordInUseError();
  }
  throw error;
}
