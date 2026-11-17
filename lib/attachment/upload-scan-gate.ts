/**
 * Runs the deployment's upload scan hook (lib/upload-scan.ts, Issue #1279) and turns its result
 * into the upload route's answer. A refusal is 422, a scanner error 503 (fail closed); the log
 * line carries the outcome and the hook's reason, never the file name or its bytes.
 */
import { logger } from '@/lib/logger';
import { scanUpload, type UploadScanInput } from '@/lib/upload-scan';

export type UploadScanDecision = { ok: true } | { ok: false; status: 422 | 503; error: string };

export async function checkUploadScan(input: UploadScanInput): Promise<UploadScanDecision> {
  try {
    const result = await scanUpload(input);
    if (result && result.ok === true) return { ok: true };
    logger.warn('[upload:scan_rejected]', JSON.stringify({ reason: result?.reason ?? null, extension: input.extension }));
    return { ok: false, status: 422, error: 'The file was rejected by the malware scan.' };
  } catch (err) {
    logger.error('[upload:scan_failed]', { name: err instanceof Error ? err.name : typeof err });
    return { ok: false, status: 503, error: 'The file could not be scanned. Try again later.' };
  }
}
