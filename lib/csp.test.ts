import { describe, expect, it } from 'vitest';
import {
  CSP_REPORT_PATH,
  buildCspReportOnly,
  cspReportOnlyFromEnv,
  generateNonce,
  parseSourceList,
} from './csp';

describe('generateNonce', () => {
  it('returns a base64 value with 128 bits that differs per call', () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });
});

describe('parseSourceList', () => {
  it('accepts space- and comma-separated origins', () => {
    expect(parseSourceList('https://cdn.example.com, https://*.stats.example.com:8443 blob:')).toEqual([
      'https://cdn.example.com',
      'https://*.stats.example.com:8443',
      'blob:',
    ]);
  });

  it('drops entries that could add a directive or a keyword source', () => {
    expect(parseSourceList("'unsafe-inline' https://a.example;script-src")).toEqual([]);
    expect(parseSourceList("https://ok.example 'unsafe-eval' https://also-ok.example")).toEqual([
      'https://ok.example',
      'https://also-ok.example',
    ]);
  });

  it('returns nothing for an unset or empty value', () => {
    expect(parseSourceList(undefined)).toEqual([]);
    expect(parseSourceList('  ')).toEqual([]);
  });
});

describe('buildCspReportOnly', () => {
  const policy = buildCspReportOnly({ nonce: 'abc' });
  const directive = (name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `));

  it('puts the nonce on script and style sources and reports to the report route', () => {
    expect(directive('script-src')).toBe("script-src 'self' 'nonce-abc'");
    expect(directive('style-src')).toBe("style-src 'self' 'nonce-abc'");
    expect(directive('report-uri')).toBe(`report-uri ${CSP_REPORT_PATH}`);
  });

  it('does not allow inline or eval script by default', () => {
    expect(directive('script-src')).not.toMatch(/unsafe-(inline|eval)/);
  });

  it('allows eval only in development', () => {
    expect(buildCspReportOnly({ nonce: 'abc', development: true })).toContain("'unsafe-eval'");
  });

  it('adds extra script origins to script-src and storage origins to img, media and connect', () => {
    const extended = buildCspReportOnly({
      nonce: 'abc',
      extraScriptSrc: ['https://js.example.com'],
      extraStorageSrc: ['https://files.example.com'],
    });
    expect(extended).toContain("script-src 'self' 'nonce-abc' https://js.example.com");
    for (const name of ['img-src', 'media-src', 'connect-src']) {
      expect(extended.split('; ').find((d) => d.startsWith(`${name} `))).toContain('https://files.example.com');
    }
    expect(extended.split('; ').find((d) => d.startsWith('script-src '))).not.toContain('files.example.com');
  });
});

describe('cspReportOnlyFromEnv', () => {
  it('reads both extension variables', () => {
    const value = cspReportOnlyFromEnv('n', {
      CSP_EXTRA_SCRIPT_SRC: 'https://js.example.com',
      CSP_EXTRA_STORAGE_SRC: 'https://storage.googleapis.com',
      NODE_ENV: 'production',
    });
    expect(value).toContain('https://js.example.com');
    expect(value).toContain('https://storage.googleapis.com');
    expect(value).not.toContain('unsafe-eval');
  });
});
