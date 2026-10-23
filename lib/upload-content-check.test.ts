import { describe, it, expect } from 'vitest';
import { contentMatchesDeclaredType, uploadContentMatchesDeclaredType } from './upload-content-check';

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...b: number[]) => Uint8Array.from(b);
const pad = (head: Uint8Array, total = 64) => {
  const out = new Uint8Array(total);
  out.set(head);
  return out;
};

const ZIP_HEAD = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const OLE_HEAD = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);

// One genuine sample per allow-listed MIME type (keep in step with `validTypes`
// in code_generator/templates/upload_route_*.ts.jinja2).
const GENUINE: Record<string, Uint8Array> = {
  'image/jpeg': pad(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)),
  'image/jpg': pad(bytes(0xff, 0xd8, 0xff, 0xdb)),
  'image/png': pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00)),
  'image/gif': enc('GIF89a\x01\x00\x01\x00'),
  'image/webp': pad(bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50)),
  'application/pdf': enc('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj'),
  'application/msword': pad(OLE_HEAD),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': pad(ZIP_HEAD),
  'application/vnd.ms-excel': pad(OLE_HEAD),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': pad(ZIP_HEAD),
  'text/csv': enc('id,name\n1,Alice\n2,Bob\n'),
  'text/plain': enc('Just some notes.\nSecond line.\n'),
  'application/zip': pad(ZIP_HEAD),
};

const HTML = enc('<!DOCTYPE html><html><body><script>alert(1)</script></body></html>');

describe('contentMatchesDeclaredType', () => {
  it.each(Object.entries(GENUINE))('accepts genuine %s content', (type, sample) => {
    expect(contentMatchesDeclaredType(sample, type)).toBe(true);
  });

  it.each(Object.keys(GENUINE).filter((t) => !t.startsWith('text/') && t !== 'application/vnd.ms-excel'))(
    'rejects HTML declared as %s',
    (type) => {
      expect(contentMatchesDeclaredType(HTML, type)).toBe(false);
    },
  );

  it.each(['text/plain', 'text/csv', 'application/vnd.ms-excel'])('rejects HTML declared as %s', (type) => {
    expect(contentMatchesDeclaredType(HTML, type)).toBe(false);
    expect(contentMatchesDeclaredType(enc('﻿  \n<svg onload="x()"></svg>'), type)).toBe(false);
    expect(contentMatchesDeclaredType(enc('<SCRIPT>x()</SCRIPT>'), type)).toBe(false);
  });

  it('rejects binary content declared as a text type', () => {
    expect(contentMatchesDeclaredType(GENUINE['image/png']!, 'text/plain')).toBe(false);
    expect(contentMatchesDeclaredType(GENUINE['application/zip']!, 'text/csv')).toBe(false);
  });

  it('rejects an image declared as another image type or as a document', () => {
    expect(contentMatchesDeclaredType(GENUINE['image/png']!, 'image/jpeg')).toBe(false);
    expect(contentMatchesDeclaredType(GENUINE['image/jpeg']!, 'application/pdf')).toBe(false);
    expect(contentMatchesDeclaredType(GENUINE['application/zip']!, 'application/msword')).toBe(false);
  });

  it('rejects a RIFF file that is not WebP', () => {
    const wav = pad(bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45));
    expect(contentMatchesDeclaredType(wav, 'image/webp')).toBe(false);
  });

  it('accepts a plain CSV labelled application/vnd.ms-excel (how common clients label .csv)', () => {
    expect(contentMatchesDeclaredType(GENUINE['text/csv']!, 'application/vnd.ms-excel')).toBe(true);
  });

  it('accepts text that merely mentions markup later in the file', () => {
    expect(contentMatchesDeclaredType(enc('Notes about <html> tags in docs\n'), 'text/plain')).toBe(true);
    expect(contentMatchesDeclaredType(enc('a,b\n"<b>bold</b>",2\n'), 'text/csv')).toBe(true);
  });

  it('accepts a PDF whose header is preceded by a few bytes of junk', () => {
    expect(contentMatchesDeclaredType(enc('\n\n  %PDF-1.4\n'), 'application/pdf')).toBe(true);
  });

  it('accepts an empty file for any allow-listed type and rejects an unknown declared type', () => {
    for (const type of Object.keys(GENUINE)) expect(contentMatchesDeclaredType(new Uint8Array(), type)).toBe(true);
    expect(contentMatchesDeclaredType(GENUINE['text/plain']!, 'text/html')).toBe(false);
  });
});

describe('uploadContentMatchesDeclaredType', () => {
  it('reads the declared type and leading bytes from the File', async () => {
    const png = new File([GENUINE['image/png']!], 'a.png', { type: 'image/png' });
    const lying = new File([HTML], 'a.png', { type: 'image/png' });
    expect(await uploadContentMatchesDeclaredType(png)).toBe(true);
    expect(await uploadContentMatchesDeclaredType(lying)).toBe(false);
  });
});
