/**
 * Optional malware scan of an uploaded file (Issue #1279, ASVS V5.4.3).
 *
 * POST /api/upload calls `scanUpload()` after the size, type and signature checks and before the
 * file is stored (through lib/attachment/upload-scan-gate.ts). This default accepts every file, so
 * behavior is unchanged until a deployment provides its own scanner: replace this file through
 * `prj/lib/upload-scan.ts` (copied over it by `prj:sync`), keeping the exported names and types.
 *
 * - Return `{ ok: true }` to store the file, `{ ok: false }` to refuse it (the caller gets 422 and
 *   nothing is stored). `reason` is written to the log, never sent to the caller.
 * - Throwing (scanner down, timeout) refuses the upload with 503: the gate fails closed.
 * - The whole file is available through `bytes()`; the route has already capped its size
 *   (UPLOAD_MAX_BYTES). The caller-supplied file name is deliberately not passed: the route never
 *   uses it for anything but display.
 *
 * See docs/knowledge/upload-limits-and-malicious-file-handling.md ("Scan hook").
 */

export type UploadScanInput = {
  /** Content-Type derived from the checked extension (not the client's declaration). */
  contentType: string;
  /** Lower-case extension without the dot, as checked by lib/_upload_validation.ts. */
  extension: string;
  size: number;
  /** The authenticated uploader. */
  userId: string;
  bytes: () => Promise<Uint8Array>;
};

export type UploadScanResult = { ok: true } | { ok: false; reason?: string };

/** True when this file is the default (no scanner). A replacement sets it to false. */
export const UPLOAD_SCAN_IS_DEFAULT = true;

export async function scanUpload(input: UploadScanInput): Promise<UploadScanResult> {
  void input;
  return { ok: true };
}
