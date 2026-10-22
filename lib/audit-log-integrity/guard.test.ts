import { describe, expect, it } from 'vitest';
import { AuditLogAppendOnlyError, assertAuditLogOperationAllowed } from './guard';

describe('audit_log append-only guard', () => {
  it.each(['update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany'])(
    'rejects %s on audit_log and audit_log_digest',
    (operation) => {
      expect(() => assertAuditLogOperationAllowed('audit_log', operation)).toThrow(AuditLogAppendOnlyError);
      expect(() => assertAuditLogOperationAllowed('audit_log_digest', operation)).toThrow(AuditLogAppendOnlyError);
    },
  );

  it.each(['create', 'createMany', 'createManyAndReturn', 'findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'])(
    'allows %s on audit_log',
    (operation) => {
      expect(() => assertAuditLogOperationAllowed('audit_log', operation)).not.toThrow();
    },
  );

  it('does not touch other models', () => {
    expect(() => assertAuditLogOperationAllowed('user', 'deleteMany')).not.toThrow();
  });
});
