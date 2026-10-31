import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertCellAndStatus, type SecurityManifest } from './security_core';
import { loadManifest } from './security_manifest';
import { makeExpectDeniedFor } from './security';

const manifest: SecurityManifest = {
  axes: ['operation', 'case'],
  denied_status: { case: { permission_denied: 403, cross_org: 404 } },
  entities: {
    widget: {
      cells: [
        { operation: 'update', case: 'permission_denied' },
        { operation: 'update', case: 'cross_org' },
      ],
    },
  },
};
const denied = { entity: 'widget', operation: 'update', case: 'permission_denied' };

function harness(opts: { status: number; mutate?: boolean }) {
  let rows: unknown = [{ id: 'a', name: 'before' }];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const expectDeniedFor = makeExpectDeniedFor({
    manifest: () => manifest,
    readSnapshot: async () => JSON.parse(JSON.stringify(rows)),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (opts.mutate) rows = [{ id: 'a', name: 'after' }];
      return new Response('{}', { status: opts.status });
    }) as unknown as typeof fetch,
  });
  return { expectDeniedFor, calls };
}
const request = { method: 'PATCH', url: 'http://x/api/widget/a/rename', body: { name: 'after' } };
const persistence = { model: 'widget', where: { id: 'a' } };

describe('security test helpers', () => {
  it('passes when the explicit status is returned and the row is unchanged', async () => {
    const { expectDeniedFor: denyCheck, calls } = harness({ status: 403 });
    await denyCheck({ cell: denied, status: 403, actor: { apiKey: 'k' }, request, persistence });
    expect((calls[0].init?.headers as Record<string, string>)['X-API-Key']).toBe('k');
  });

  it('fails on a different status, even another 4xx', async () => {
    const { expectDeniedFor: denyCheck } = harness({ status: 404 });
    await expect(denyCheck({ cell: denied, status: 403, actor: { apiKey: 'k' }, request, persistence })).rejects.toThrow(
      'returned 404, expected 403',
    );
  });

  it('fails when the denied write persisted, by re-reading the rows', async () => {
    const { expectDeniedFor: denyCheck } = harness({ status: 403, mutate: true });
    await expect(denyCheck({ cell: denied, status: 403, actor: { apiKey: 'k' }, request, persistence })).rejects.toThrow(
      'the denied write persisted',
    );
  });

  it('requires persistence for a write', async () => {
    const { expectDeniedFor: denyCheck } = harness({ status: 403 });
    await expect(denyCheck({ cell: denied, status: 403, actor: { apiKey: 'k' }, request })).rejects.toThrow('persistence');
  });

  it('accepts a read without persistence', async () => {
    const { expectDeniedFor: denyCheck } = harness({ status: 403 });
    await denyCheck({ cell: denied, status: 403, actor: { apiKey: 'k' }, request: { method: 'GET', url: 'http://x/api/widget' } });
  });

  it('rejects a cell the manifest does not have, a range-like status and a status the matrix does not declare', () => {
    expect(() => assertCellAndStatus({ entity: 'widget', operation: 'delete', case: 'permission_denied' }, 403, manifest)).toThrow('no cell');
    expect(() => assertCellAndStatus({ entity: 'nope', operation: 'update', case: 'permission_denied' }, 403, manifest)).toThrow('not in the security manifest');
    expect(() => assertCellAndStatus(denied, 400, manifest)).toThrow('401/403/404');
    expect(() => assertCellAndStatus(denied, 404, manifest)).toThrow('declares status 403');
    expect(() => assertCellAndStatus({ ...denied, case: 'cross_org' }, 404, manifest)).not.toThrow();
  });

  it('reads the manifest generate-code writes and fails clearly without it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-manifest-'));
    expect(() => loadManifest(dir)).toThrow('generate-code');
    fs.writeFileSync(path.join(dir, '.security-manifest.json'), JSON.stringify(manifest));
    expect(loadManifest(dir).axes).toEqual(['operation', 'case']);
  });
});
