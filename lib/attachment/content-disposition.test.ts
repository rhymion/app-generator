import { describe, expect, it } from 'vitest';
import { contentDisposition } from './content-disposition';

// The quoted `filename="..."` value and the `filename*=` value of a header.
function parts(header: string): { kind: string; ascii: string; encoded: string } {
  const match = /^(inline|attachment); filename="([^]*)"; filename\*=UTF-8''(.*)$/.exec(header);
  if (!match) throw new Error(`unexpected header shape: ${JSON.stringify(header)}`);
  return { kind: match[1], ascii: match[2], encoded: match[3] };
}

describe('contentDisposition', () => {
  it('keeps the disposition kind and a plain name unchanged', () => {
    expect(contentDisposition('attachment', 'report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    expect(parts(contentDisposition('inline', 'photo.png')).kind).toBe('inline');
  });

  it('replaces double quotes and backslashes in the ASCII fallback so the quoted string cannot be closed early', () => {
    const { ascii, encoded } = parts(contentDisposition('attachment', 'a"b\\c.txt'));
    expect(ascii).toBe('a_b_c.txt');
    expect(ascii).not.toMatch(/["\\]/);
    expect(encoded).toBe('a%22b%5Cc.txt');
  });

  it('replaces CR and LF so a name cannot inject a header line', () => {
    const header = contentDisposition('attachment', 'x.txt\r\nSet-Cookie: a=b');
    expect(header).not.toMatch(/[\r\n]/);
    const { ascii, encoded } = parts(header);
    expect(ascii).toBe('x.txt__Set-Cookie: a=b');
    expect(encoded).toContain('%0D%0A');
  });

  it('gives a non-ASCII name an ASCII-only fallback and a percent-encoded filename*', () => {
    const header = contentDisposition('attachment', '見積書.pdf');
    const { ascii, encoded } = parts(header);
    expect(ascii).toBe('___.pdf');
    expect(ascii).toMatch(/^[\x20-\x7e]*$/);
    expect(encoded).toBe(encodeURIComponent('見積書.pdf'));
    expect(encoded).toMatch(/^[A-Za-z0-9%._~!'()*-]*$/);
    expect(decodeURIComponent(encoded)).toBe('見積書.pdf');
  });

  it('never leaves a control or non-ASCII character in the ASCII fallback', () => {
    const name = 'a\u0000b\u001fc\u007fd\u0080e\u2028f"g\\h';
    const { ascii } = parts(contentDisposition('inline', name));
    expect(ascii).toMatch(/^[\x20-\x7e]*$/);
    expect(ascii).not.toMatch(/["\\]/);
  });
});
