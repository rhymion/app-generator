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

export type UploadCheck = { ok: true; contentType: string } | { ok: false };

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
  return { ok: true, contentType: UPLOAD_CONTENT_TYPE_BY_EXTENSION[extension] ?? declared };
}
