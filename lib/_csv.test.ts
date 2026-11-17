import { describe, it, expect } from 'vitest';

import { escapeCSV, unescapeImportValue } from './_csv';

describe('escapeCSV', () => {
  it('writes null and undefined as an empty field', () => {
    expect(escapeCSV(null)).toBe('');
    expect(escapeCSV(undefined)).toBe('');
  });

  it('leaves a plain value unquoted', () => {
    expect(escapeCSV('plain')).toBe('plain');
    expect(escapeCSV(42)).toBe('42');
  });

  it.each([
    ['a,b', '"a,b"'],
    ['line1\nline2', '"line1\nline2"'],
    ['line1\rline2', '"line1\rline2"'],
    ['say "hi"', '"say ""hi"""'],
  ])('quotes %j and doubles embedded quotes', (input, expected) => {
    expect(escapeCSV(input)).toBe(expected);
  });

  it('keeps a value that tries to close the quote and start a new field inside one field', () => {
    expect(escapeCSV('x","injected')).toBe('"x"",""injected"');
  });

  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '=HYPERLINK("http://evil.example")'])(
    'neutralizes the spreadsheet formula %j with a leading tab',
    (input) => {
      const out = escapeCSV(input);
      expect(out.replace(/^"/, '').startsWith('\t')).toBe(true);
      expect(out.replace(/^"/, '').startsWith(input[0])).toBe(false);
    },
  );

  it('does not prefix a value whose formula character is not first', () => {
    expect(escapeCSV('a=1')).toBe('a=1');
  });

  it('serializes a Date as ISO 8601 and an object as JSON', () => {
    expect(escapeCSV(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(escapeCSV({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('unescapeImportValue', () => {
  it.each(['=1+1', '+1', '-1', '@x'])('restores %j after an export round trip', (input) => {
    const exported = escapeCSV(input);
    const field = exported.startsWith('"') ? exported.slice(1, -1).replace(/""/g, '"') : exported;
    expect(unescapeImportValue(field)).toBe(input);
  });

  it('leaves a value without the tab escape alone', () => {
    expect(unescapeImportValue('=1+1')).toBe('=1+1');
    expect(unescapeImportValue('\tplain')).toBe('\tplain');
  });
});
