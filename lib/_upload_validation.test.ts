import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UPLOAD_EXTENSIONS,
  DEFAULT_UPLOAD_MIME_TYPES,
  UPLOAD_CONTENT_TYPE_BY_EXTENSION,
  checkUpload,
  extensionOf,
  loadUploadPolicy,
  matchesFileSignature,
  readBodyWithLimit,
  uploadMaxBytes,
} from './_upload_validation';

const defaults = loadUploadPolicy({});

describe('default policy keeps legitimate business documents working', () => {
  // Every allow-listed extension, uploaded with the MIME type browsers send for it.
  const cases: Array<[string, string]> = [
    ['photo.jpg', 'image/jpeg'], ['photo.jpeg', 'image/jpeg'], ['photo.jpg', 'image/jpg'],
    ['photo.png', 'image/png'], ['anim.gif', 'image/gif'], ['pic.webp', 'image/webp'],
    ['doc.pdf', 'application/pdf'],
    ['letter.doc', 'application/msword'],
    ['letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sheet.xls', 'application/vnd.ms-excel'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['rows.csv', 'text/csv'],
    ['rows.csv', 'application/vnd.ms-excel'],
    ['notes.txt', 'text/plain'],
    ['bundle.zip', 'application/zip'],
  ];
  it.each(cases)('accepts %s declared as %s', (name, type) => {
    expect(checkUpload({ name, type }, defaults).ok).toBe(true);
  });

  it('covers every default extension and every default MIME type at least once', () => {
    for (const ext of DEFAULT_UPLOAD_EXTENSIONS) expect(cases.some(([n]) => extensionOf(n) === ext)).toBe(true);
    for (const mime of DEFAULT_UPLOAD_MIME_TYPES) expect(cases.some(([, t]) => t === mime)).toBe(true);
  });

  it('every default extension has a derived Content-Type that is itself allow-listed', () => {
    for (const ext of DEFAULT_UPLOAD_EXTENSIONS) {
      expect(DEFAULT_UPLOAD_MIME_TYPES).toContain(UPLOAD_CONTENT_TYPE_BY_EXTENSION[ext]);
    }
  });

  it('matches extensions case-insensitively and ignores MIME parameters', () => {
    expect(checkUpload({ name: 'SCAN.PDF', type: 'application/pdf' }, defaults).ok).toBe(true);
    expect(checkUpload({ name: 'a.txt', type: 'text/plain; charset=utf-8' }, defaults).ok).toBe(true);
  });
});

describe('the Content-Type comes from the file name, not the request', () => {
  it('stores the canonical type for the extension', () => {
    expect(checkUpload({ name: 'a.jpg', type: 'image/jpg' }, defaults)).toEqual({ ok: true, contentType: 'image/jpeg', extension: 'jpg' });
    expect(checkUpload({ name: 'a.csv', type: 'application/vnd.ms-excel' }, defaults)).toEqual({ ok: true, contentType: 'text/csv', extension: 'csv' });
  });
});

describe('rejections', () => {
  it.each([
    ['page.html', 'text/plain'],
    ['page.html', 'text/html'],
    ['image.svg', 'image/png'],
    ['image.svg', 'image/svg+xml'],
    ['song.mp3', 'image/png'],
    ['script.js', 'application/pdf'],
    ['noextension', 'image/png'],
    ['.png', 'image/png'],
    ['photo.png', 'text/html'],
    ['photo.png', ''],
    ['photo.png.exe', 'image/png'],
  ])('rejects %s declared as %s', (name, type) => {
    expect(checkUpload({ name, type }, defaults).ok).toBe(false);
  });
});

describe('environment configuration', () => {
  it('falls back to the defaults when unset or blank', () => {
    expect(loadUploadPolicy({}).mimeTypes).toEqual(DEFAULT_UPLOAD_MIME_TYPES);
    expect(loadUploadPolicy({ UPLOAD_ALLOWED_MIME_TYPES: ' , ', UPLOAD_ALLOWED_EXTENSIONS: '' }).extensions).toEqual(DEFAULT_UPLOAD_EXTENSIONS);
  });

  it('narrows to images and PDF, and both lists must match', () => {
    const locked = loadUploadPolicy({
      UPLOAD_ALLOWED_MIME_TYPES: 'image/jpeg, image/png, application/pdf',
      UPLOAD_ALLOWED_EXTENSIONS: '.jpg,.png,pdf',
    });
    expect(checkUpload({ name: 'a.pdf', type: 'application/pdf' }, locked).ok).toBe(true);
    expect(checkUpload({ name: 'a.doc', type: 'application/msword' }, locked).ok).toBe(false);
    expect(checkUpload({ name: 'a.docx', type: 'application/pdf' }, locked).ok).toBe(false);
    expect(checkUpload({ name: 'a.png', type: 'application/msword' }, locked).ok).toBe(false);
  });
});

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe('matchesFileSignature', () => {
  it.each([
    ['jpg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['jpeg', bytes(0xff, 0xd8, 0xff, 0xdb)],
    ['png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)],
    ['gif', ascii('GIF89a....')],
    ['webp', ascii('RIFF\0\0\0\0WEBPVP8 ')],
    ['pdf', ascii('%PDF-1.7\n')],
    ['zip', bytes(0x50, 0x4b, 0x03, 0x04, 0x14)],
    ['docx', bytes(0x50, 0x4b, 0x03, 0x04, 0x14)],
    ['xlsx', bytes(0x50, 0x4b, 0x03, 0x04, 0x14)],
    ['doc', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00)],
    ['xls', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00)],
    ['csv', ascii('a,b\n1,2\n')],
    ['txt', ascii('plain text')],
  ])('accepts the leading bytes of a real .%s file', (extension, head) => {
    expect(matchesFileSignature(head, extension)).toBe(true);
  });

  it.each([
    ['png', ascii('<script>alert(1)</script>')],
    ['jpg', ascii('%PDF-1.7')],
    ['gif', ascii('GIF8')],
    ['webp', ascii('RIFF\0\0\0\0WAVE')],
    ['pdf', ascii('<html>')],
    ['zip', ascii('MZ')],
    ['docx', ascii('plain text')],
    ['doc', ascii('plain text')],
    ['pdf', bytes()],
    ['csv', bytes(0x61, 0x00, 0x62)],
    ['txt', bytes(0x4d, 0x5a, 0x00, 0x00)],
  ])('rejects bytes that are not a .%s file', (extension, head) => {
    expect(matchesFileSignature(head, extension)).toBe(false);
  });

  it('cannot verify an extension it has no signature for, so it accepts it on the allow-lists alone', () => {
    expect(matchesFileSignature(ascii('anything'), 'ods')).toBe(true);
  });
});

describe('uploadMaxBytes', () => {
  it('defaults to 10 MiB and honours a positive UPLOAD_MAX_BYTES', () => {
    expect(uploadMaxBytes({})).toBe(10 * 1024 * 1024);
    expect(uploadMaxBytes({ UPLOAD_MAX_BYTES: '2048' })).toBe(2048);
  });

  it('falls back to the default for a value that is not a positive number', () => {
    expect(uploadMaxBytes({ UPLOAD_MAX_BYTES: 'abc' })).toBe(10 * 1024 * 1024);
    expect(uploadMaxBytes({ UPLOAD_MAX_BYTES: '0' })).toBe(10 * 1024 * 1024);
  });
});

describe('readBodyWithLimit', () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/upload', { method: 'POST', body, headers, ...(body ? { duplex: 'half' } : {}) } as RequestInit);

  it('returns the whole body when it fits', async () => {
    const body = await readBodyWithLimit(post('hello world'), 100);
    expect(new TextDecoder().decode(body as Uint8Array)).toBe('hello world');
  });

  it('refuses a declared Content-Length over the limit without reading the body', async () => {
    const request = post('x', { 'content-length': '1000' });
    const getReader = vi.spyOn(request.body as ReadableStream, 'getReader');
    expect(await readBodyWithLimit(request, 100)).toBeNull();
    expect(getReader).not.toHaveBeenCalled();
  });

  it('stops reading a stream that exceeds the limit with no Content-Length, without buffering it whole', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 1000) controller.close();
      },
    });
    const request = new Request('http://localhost/api/upload', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await readBodyWithLimit(request, 4096)).toBeNull();
    expect(pulled).toBeLessThan(20);
  });

  it('counts the bytes actually received, not a Content-Length that understates them', async () => {
    const request = post('x'.repeat(500), { 'content-length': '10' });
    expect(await readBodyWithLimit(request, 100)).toBeNull();
  });

  it('answers an empty body for a request without one', async () => {
    const body = await readBodyWithLimit(post(null), 100);
    expect(body?.byteLength).toBe(0);
  });
});
