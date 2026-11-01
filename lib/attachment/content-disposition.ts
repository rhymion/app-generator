// Builds the Content-Disposition header of an attachment download from the stored original file name.
//
// The header carries two names: an ASCII `filename` fallback in which every control character,
// non-ASCII character, double quote and backslash is replaced by `_` (so a name can neither break out of
// the quoted string nor inject a header line), and an RFC 5987 `filename*` that carries the exact name
// percent-encoded. The name comes from the stored record, never from the request URL.
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
