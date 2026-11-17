import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scanUpload } = vi.hoisted(() => ({ scanUpload: vi.fn() }));
vi.mock('@/lib/upload-scan', () => ({ scanUpload }));

import { checkUploadScan } from '@/lib/attachment/upload-scan-gate';

const input = {
  contentType: 'application/pdf',
  extension: 'pdf',
  size: 3,
  userId: 'u1',
  bytes: async () => new Uint8Array([1, 2, 3]),
};

describe('checkUploadScan (Issue #1279)', () => {
  beforeEach(() => {
    scanUpload.mockReset();
  });

  it('passes the checked file to the hook and accepts what it accepts', async () => {
    scanUpload.mockResolvedValue({ ok: true });
    await expect(checkUploadScan(input)).resolves.toEqual({ ok: true });
    expect(scanUpload).toHaveBeenCalledWith(input);
  });

  it('refuses with 422 when the hook rejects, without echoing its reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scanUpload.mockResolvedValue({ ok: false, reason: 'EICAR-Test-Signature' });
    const decision = await checkUploadScan(input);
    expect(decision).toEqual({ ok: false, status: 422, error: 'The file was rejected by the malware scan.' });
    expect(JSON.stringify(decision)).not.toContain('EICAR');
    warn.mockRestore();
  });

  it('fails closed with 503 when the hook throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    scanUpload.mockImplementation(() => {
      throw new TypeError('scanner unreachable');
    });
    await expect(checkUploadScan(input)).resolves.toMatchObject({ ok: false, status: 503 });
    error.mockRestore();
  });

  it('treats a malformed result as a refusal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scanUpload.mockResolvedValue(undefined);
    await expect(checkUploadScan(input)).resolves.toMatchObject({ ok: false, status: 422 });
    warn.mockRestore();
  });
});

describe('default lib/upload-scan.ts', () => {
  it('accepts every file, so behavior is unchanged without a scanner', async () => {
    const actual = await vi.importActual<typeof import('@/lib/upload-scan')>('@/lib/upload-scan');
    expect(actual.UPLOAD_SCAN_IS_DEFAULT).toBe(true);
    await expect(actual.scanUpload(input)).resolves.toEqual({ ok: true });
  });
});
