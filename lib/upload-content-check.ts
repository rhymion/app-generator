/**
 * Upload content check — used by the generated `app/api/upload/route.ts`
 * (Vercel Blob and GCS variants).
 *
 * The upload route validates the client-declared MIME type against an
 * allow-list, but the declared type is only a claim. This check compares the
 * leading bytes of the file with the signature that type implies, so a file
 * cannot be stored (and later served) under a type its content does not
 * match. It reads only the first `SNIFF_BYTES` bytes and needs no dependency.
 *
 * Rules per allow-listed type:
 *   - images, PDF, ZIP and the Office formats must start with their magic
 *     bytes (OOXML documents are ZIP containers);
 *   - text types (`text/plain`, `text/csv`) must look like text: no NUL byte
 *     in the sample and no HTML/SVG/script start tag;
 *   - `application/vnd.ms-excel` accepts either the legacy OLE2 signature or
 *     text, because common clients label plain `.csv` files with this type.
 *
 * An empty file has nothing to compare and is accepted.
 */

export const SNIFF_BYTES = 8192;

type Signature = { offset: number; bytes: number[] };

const JPEG: Signature[] = [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }];
const PNG: Signature[] = [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }];
const GIF: Signature[] = [
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
];
// RIFF container whose form type (offset 8) is WEBP; the 4 size bytes between are not checked.
const WEBP_RIFF: Signature = { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] };
const WEBP_FORM: Signature = { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] };
const OLE2: Signature[] = [{ offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }];
const ZIP: Signature[] = [
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }, // local file header
  { offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }, // empty archive
];
// PDF readers accept the header anywhere in the first 1024 bytes.
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PDF_WINDOW = 1024;

const HTML_START = /^(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]|<svg[\s>]|<iframe[\s>])/i;

function matchesAt(bytes: Uint8Array, sig: Signature): boolean {
  if (bytes.length < sig.offset + sig.bytes.length) return false;
  return sig.bytes.every((b, i) => bytes[sig.offset + i] === b);
}

function matchesAny(bytes: Uint8Array, sigs: Signature[]): boolean {
  return sigs.some((sig) => matchesAt(bytes, sig));
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, PDF_WINDOW) - PDF_HEADER.length;
  for (let i = 0; i <= end; i++) {
    if (PDF_HEADER.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  // Skip a UTF-8 BOM and leading whitespace, then reject markup that a browser could render.
  let start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (start < bytes.length && (bytes[start] === 0x20 || (bytes[start]! >= 0x09 && bytes[start]! <= 0x0d))) start++;
  const head = new TextDecoder('utf-8').decode(bytes.subarray(start, start + 64));
  return !HTML_START.test(head);
}

/**
 * True when `bytes` (at least the first `SNIFF_BYTES` bytes of the file) fit
 * the declared MIME type. A declared type outside the allow-list returns
 * false; the route rejects those earlier, so this is a safety net.
 */
export function contentMatchesDeclaredType(bytes: Uint8Array, declaredType: string): boolean {
  if (bytes.length === 0) return true;
  switch (declaredType) {
    case 'image/jpeg':
    case 'image/jpg':
      return matchesAny(bytes, JPEG);
    case 'image/png':
      return matchesAny(bytes, PNG);
    case 'image/gif':
      return matchesAny(bytes, GIF);
    case 'image/webp':
      return matchesAt(bytes, WEBP_RIFF) && matchesAt(bytes, WEBP_FORM);
    case 'application/pdf':
      return hasPdfHeader(bytes);
    case 'application/msword':
      return matchesAny(bytes, OLE2);
    case 'application/vnd.ms-excel':
      return matchesAny(bytes, OLE2) || looksLikeText(bytes);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/zip':
      return matchesAny(bytes, ZIP);
    case 'text/csv':
    case 'text/plain':
      return looksLikeText(bytes);
    default:
      return false;
  }
}

/** Reads the leading bytes of an uploaded file and checks them against its declared type. */
export async function uploadContentMatchesDeclaredType(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  return contentMatchesDeclaredType(head, file.type);
}
