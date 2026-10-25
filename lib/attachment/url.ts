// The URL an attachment is read from. It is keyed by the attachment's own id; the storage key of
// the object never leaves the server.
export function attachmentUrl(id: string): string {
  return `/api/attachments/${id}`;
}
