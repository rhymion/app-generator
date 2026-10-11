/**
 * Application-level guard for the append-only `audit_log` table.
 *
 * A Prisma Client query extension that rejects every write operation on
 * `audit_log` and `audit_log_digest` except inserts. It is the first of three
 * layers (guard, row trigger, restricted database role) described in
 * docs/knowledge/audit-log-append-only.md; it stops generated CRUD, service
 * code and ad-hoc scripts that use the application's Prisma client before the
 * statement ever reaches the database.
 *
 * Deny-by-prefix rather than a fixed list so a write operation Prisma adds
 * later (as it did with `updateManyAndReturn`) is rejected without a change
 * here.
 */
import { Prisma } from '@/app/generated/prisma/client';

const GUARDED_MODELS = new Set(['audit_log', 'audit_log_digest']);
const REJECTED_OPERATION = /^(update|upsert|delete)/;

export class AuditLogAppendOnlyError extends Error {
  constructor(model: string, operation: string) {
    super(`${model} is append-only: ${operation} is not allowed`);
    this.name = 'AuditLogAppendOnlyError';
  }
}

export function assertAuditLogOperationAllowed(model: string, operation: string): void {
  if (GUARDED_MODELS.has(model) && REJECTED_OPERATION.test(operation)) {
    throw new AuditLogAppendOnlyError(model, operation);
  }
}

export const auditLogAppendOnlyExtension = Prisma.defineExtension({
  name: 'audit-log-append-only',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        assertAuditLogOperationAllowed(model, operation);
        return query(args);
      },
    },
  },
});
