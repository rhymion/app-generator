import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UPLOAD_EXTENSIONS,
  DEFAULT_UPLOAD_MIME_TYPES,
  UPLOAD_CONTENT_TYPE_BY_EXTENSION,
  checkUpload,
  extensionOf,
  loadUploadPolicy,
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
    expect(checkUpload({ name: 'a.jpg', type: 'image/jpg' }, defaults)).toEqual({ ok: true, contentType: 'image/jpeg' });
    expect(checkUpload({ name: 'a.csv', type: 'application/vnd.ms-excel' }, defaults)).toEqual({ ok: true, contentType: 'text/csv' });
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
