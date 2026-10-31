// Server-side check of an uploaded file's type for the /api/upload route.
//
// The multipart `Content-Type` of a file part is chosen by the caller, so it
// is never trusted on its own: the file name's extension must ALSO be on an
// allow-list, and the Content-Type stored with (and later served for) the
// object is derived from that extension rather than echoed from the request.
//
// Both allow-lists are configurable by comma-separated environment variables;
// when a variable is unset or blank the default below applies. A file is
// accepted only when its declared MIME type is on the MIME list AND its
// extension is on the extension list.

export const DEFAULT_UPLOAD_MIME_TYPES: readonly string[] = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'application/zip',
];

export const DEFAULT_UPLOAD_EXTENSIONS: readonly string[] = [
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  'pdf',
  'doc', 'docx', 'xls', 'xlsx',
  'csv', 'txt',
  'zip',
];

// Content-Type stored and served for each known extension.
export const UPLOAD_CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  zip: 'application/zip',
};

export interface UploadPolicy {
  mimeTypes: readonly string[];
  extensions: readonly string[];
}

export type UploadCheck = { ok: true; contentType: string; extension: string } | { ok: false };

function parseList(raw: string | undefined, fallback: readonly string[], normalize: (v: string) => string): readonly string[] {
  if (raw === undefined) return fallback;
  const items = raw.split(',').map((v) => normalize(v.trim())).filter((v) => v !== '');
  return items.length > 0 ? items : fallback;
}

const normalizeMime = (v: string): string => v.split(';')[0].trim().toLowerCase();
const normalizeExtension = (v: string): string => v.replace(/^\./, '').toLowerCase();

export function loadUploadPolicy(env: Record<string, string | undefined> = process.env): UploadPolicy {
  return {
    mimeTypes: parseList(env.UPLOAD_ALLOWED_MIME_TYPES, DEFAULT_UPLOAD_MIME_TYPES, normalizeMime),
    extensions: parseList(env.UPLOAD_ALLOWED_EXTENSIONS, DEFAULT_UPLOAD_EXTENSIONS, normalizeExtension),
  };
}

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function checkUpload(file: { name: string; type: string }, policy: UploadPolicy): UploadCheck {
  const declared = normalizeMime(file.type ?? '');
  const extension = extensionOf(file.name ?? '');
  if (!policy.mimeTypes.includes(declared) || extension === '' || !policy.extensions.includes(extension)) {
    return { ok: false };
  }
  return { ok: true, contentType: UPLOAD_CONTENT_TYPE_BY_EXTENSION[extension] ?? declared, extension };
}

// --- Content signature -------------------------------------------------------
//
// The declared type and the extension are both chosen by the caller, so a file's
// leading bytes are checked against the format its extension names. An extension
// with no entry here (one added through UPLOAD_ALLOWED_EXTENSIONS) cannot be
// verified and is accepted on the allow-lists alone.

const ASCII = (s: string): number[] => Array.from(s).map((c) => c.charCodeAt(0));
const OLE2_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];

function startsWith(head: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return head.length >= offset + signature.length && signature.every((b, i) => head[offset + i] === b);
}

const SIGNATURE_CHECKS: Readonly<Record<string, (head: Uint8Array) => boolean>> = {
  jpg: (h) => startsWith(h, [0xff, 0xd8, 0xff]),
  jpeg: (h) => startsWith(h, [0xff, 0xd8, 0xff]),
  png: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  gif: (h) => startsWith(h, ASCII('GIF87a')) || startsWith(h, ASCII('GIF89a')),
  webp: (h) => startsWith(h, ASCII('RIFF')) && startsWith(h, ASCII('WEBP'), 8),
  pdf: (h) => startsWith(h, ASCII('%PDF-')),
  doc: (h) => startsWith(h, OLE2_HEADER),
  xls: (h) => startsWith(h, OLE2_HEADER),
  docx: (h) => startsWith(h, ZIP_LOCAL) || startsWith(h, ZIP_EMPTY),
  xlsx: (h) => startsWith(h, ZIP_LOCAL) || startsWith(h, ZIP_EMPTY),
  zip: (h) => startsWith(h, ZIP_LOCAL) || startsWith(h, ZIP_EMPTY),
  // Text formats have no signature: a NUL byte means the file is binary.
  csv: (h) => !h.includes(0),
  txt: (h) => !h.includes(0),
};

/** Bytes of a file that `matchesFileSignature` needs. */
export const UPLOAD_SIGNATURE_BYTES = 8192;

export function matchesFileSignature(head: Uint8Array, extension: string): boolean {
  const check = SIGNATURE_CHECKS[extension.toLowerCase()];
  return check ? check(head) : true;
}

// --- Size limit before the body is parsed ------------------------------------

export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Room for the multipart framing (boundaries, part headers, the other form fields) around the file. */
export const UPLOAD_MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export function uploadMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.UPLOAD_MAX_BYTES ?? String(DEFAULT_UPLOAD_MAX_BYTES));
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_UPLOAD_MAX_BYTES;
}

/**
 * Reads a request body but stops, and answers null, as soon as it exceeds `limit` bytes — so an oversized
 * upload is never buffered whole. A declared Content-Length over the limit is refused without reading anything;
 * a body with no (or a false) Content-Length is counted while it streams.
 */
export async function readBodyWithLimit(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
