import { describe, expect, it } from 'vitest';

import { p2002Field } from './_errors';

describe('p2002Field', () => {
  it('extracts the field from the classic { target } shape', () => {
    expect(p2002Field({ target: ['email'] })).toBe('email');
  });

  it('extracts the field from the Prisma 7.9.1 driver-adapter { constraint.fields } shape', () => {
    expect(
      p2002Field({
        modelName: 'approval_flow',
        driverAdapterError: { cause: { constraint: { fields: ['approver_role_id'] } } },
      }),
    ).toBe('approver_role_id');
  });

  it('derives a label from the Prisma 7.10.0 driver-adapter { constraint.index } shape (single-column constraint)', () => {
    expect(
      p2002Field({
        modelName: 'user',
        driverAdapterError: { cause: { constraint: { index: 'user_email_key' } } },
      }),
    ).toBe('email');
  });

  it('derives a joined label from the Prisma 7.10.0 shape for a compound unique constraint', () => {
    // Real shape empirically dumped against a live Postgres test database
    // running Prisma 7.10.0 (cmd_883): approval_flow's
    // @@unique([entity_name, approver_role_id]).
    expect(
      p2002Field({
        modelName: 'approval_flow',
        driverAdapterError: {
          cause: { constraint: { index: 'approval_flow_entity_name_approver_role_id_key' } },
        },
      }),
    ).toBe('entity_name_approver_role_id');
  });

  it('falls back to the raw index name when modelName is missing or does not match the prefix', () => {
    expect(
      p2002Field({
        driverAdapterError: { cause: { constraint: { index: 'some_table_col_key' } } },
      }),
    ).toBe('some_table_col');
  });

  it('returns undefined when none of the known shapes match', () => {
    expect(p2002Field({})).toBeUndefined();
    expect(p2002Field(null)).toBeUndefined();
    expect(p2002Field(undefined)).toBeUndefined();
    expect(p2002Field({ driverAdapterError: {} })).toBeUndefined();
  });
});
