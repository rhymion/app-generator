import { describe, expect, it } from 'vitest';
import { digestRows, serializeAuditRow, type AuditRow } from './digest';

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 'a',
  actor_user_id: 'u1',
  action: 'auth:signIn',
  target_table: null,
  target_id: null,
  metadata: { b: 1, a: { d: 2, c: 3 } },
  created_at: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

async function* rows(...items: AuditRow[]) {
  for (const item of items) yield item;
}

const start = new Date('2026-10-01T00:00:00Z');
const end = new Date('2026-10-02T00:00:00Z');

describe('audit_log digest serialization', () => {
  it('serializes metadata with sorted keys', () => {
    const swapped = row({ metadata: { a: { c: 3, d: 2 }, b: 1 } });
    expect(serializeAuditRow(row())).toBe(serializeAuditRow(swapped));
  });

  it('changes when any column changes', () => {
    const base = serializeAuditRow(row());
    expect(serializeAuditRow(row({ action: 'x' }))).not.toBe(base);
    expect(serializeAuditRow(row({ metadata: null }))).not.toBe(base);
    expect(serializeAuditRow(row({ created_at: new Date('2026-10-01T00:00:01Z') }))).not.toBe(base);
  });

  // Issue #1306: rows written before request_id existed must serialize exactly as before.
  it('serializes a row without request_id exactly as before the column existed', () => {
    const legacy = JSON.stringify(['a', 'u1', 'auth:signIn', null, null, { a: { c: 3, d: 2 }, b: 1 }, '2026-10-01T00:00:00.000Z']);
    expect(serializeAuditRow(row())).toBe(legacy);
    expect(serializeAuditRow(row({ request_id: null }))).toBe(legacy);
  });

  it('changes when request_id is set or changed', () => {
    const base = serializeAuditRow(row());
    const withId = serializeAuditRow(row({ request_id: 'r1' }));
    expect(withId).not.toBe(base);
    expect(serializeAuditRow(row({ request_id: 'r2' }))).not.toBe(withId);
  });

  it('chains to the previous digest and depends on row order', async () => {
    const a = row({ id: 'a' });
    const b = row({ id: 'b' });
    const first = await digestRows(rows(a, b), start, end, null);
    const chained = await digestRows(rows(a, b), start, end, 'prev');
    const reordered = await digestRows(rows(b, a), start, end, null);
    expect(first.rowCount).toBe(2);
    expect(chained.digest).not.toBe(first.digest);
    expect(reordered.digest).not.toBe(first.digest);
    expect((await digestRows(rows(a, b), start, end, null)).digest).toBe(first.digest);
  });
});
