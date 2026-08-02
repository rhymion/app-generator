/**
 * safeRedirectPath: open-redirect defense for the post-login `redirect`
 * query param (cmd_525). Only same-origin, path-absolute values may pass.
 */
import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from './safe-redirect';

describe('safeRedirectPath — accepts safe same-site paths', () => {
  it('accepts a plain path', () => {
    expect(safeRedirectPath('/en/dashboard')).toBe('/en/dashboard');
  });

  it('accepts a path with query string', () => {
    expect(safeRedirectPath('/en/setting?tab=2')).toBe('/en/setting?tab=2');
  });

  it('accepts a path with a hash', () => {
    expect(safeRedirectPath('/en/dashboard#widgets')).toBe('/en/dashboard#widgets');
  });

  it('accepts the root path', () => {
    expect(safeRedirectPath('/')).toBe('/');
  });
});

describe('safeRedirectPath — rejects open-redirect vectors', () => {
  it('rejects absolute URLs with a scheme', () => {
    expect(safeRedirectPath('https://evil.com')).toBeNull();
    expect(safeRedirectPath('http://evil.com/phish')).toBeNull();
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeRedirectPath('//evil.com')).toBeNull();
    expect(safeRedirectPath('//evil.com/en/dashboard')).toBeNull();
  });

  it('rejects backslash tricks browsers may normalize to //', () => {
    expect(safeRedirectPath('/\\evil.com')).toBeNull();
  });

  it('rejects values without a leading slash, including bare schemes', () => {
    expect(safeRedirectPath('dashboard')).toBeNull();
    expect(safeRedirectPath('evil.com')).toBeNull();
    expect(safeRedirectPath('javascript:alert(1)')).toBeNull();
  });

  it('rejects null, undefined, and empty string', () => {
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath('')).toBeNull();
  });
});
