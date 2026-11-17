import { describe, expect, it } from 'vitest';
import { extractCspViolations, stripUrl } from './csp-report';

describe('stripUrl', () => {
  it('drops the query string, fragment and credentials', () => {
    expect(stripUrl('https://user:pw@app.example.com/en/orders/1?token=secret&email=a@b.c#frag')).toBe(
      'https://app.example.com/en/orders/1',
    );
  });

  it('keeps keyword values and drops anything else that is not a URL', () => {
    expect(stripUrl('inline')).toBe('inline');
    expect(stripUrl('not a url with spaces')).toBe('');
    expect(stripUrl(42)).toBe('');
  });
});

describe('extractCspViolations', () => {
  it('reads the report-uri format and drops personal data', () => {
    const out = extractCspViolations({
      'csp-report': {
        'document-uri': 'https://app.example.com/en/orders?email=a@b.c',
        referrer: 'https://app.example.com/en/login?token=abc',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example.net/x.js?session=1',
        'source-file': 'https://app.example.com/en/orders',
        'line-number': 3,
        'script-sample': 'fetch("/api?token=secret")',
        disposition: 'report',
      },
    });
    expect(out).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'https://evil.example.net/x.js',
        page: 'https://app.example.com/en/orders',
        disposition: 'report',
      },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/token|email|session|secret|fetch/);
  });

  it('reads the Reporting API format', () => {
    const out = extractCspViolations([
      {
        type: 'csp-violation',
        body: { documentURL: 'https://app.example.com/', effectiveDirective: 'img-src', blockedURL: 'inline', sample: 'x' },
      },
      { type: 'deprecation', body: {} },
    ]);
    expect(out).toEqual([{ directive: 'img-src', blocked: 'inline', page: 'https://app.example.com/' }]);
  });

  it('ignores anything else', () => {
    expect(extractCspViolations(null)).toEqual([]);
    expect(extractCspViolations({ foo: 1 })).toEqual([]);
    expect(extractCspViolations({ 'csp-report': { 'violated-directive': 'bad value;' } })).toEqual([]);
  });
});
