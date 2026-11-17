import { describe, expect, it } from 'vitest';
import { allowedHostnames, isAllowedHost, resolveExternalUrl } from './external-url';

const env = { AUTH_URL: 'https://app.example.com' };

function resolve(headers: { fwdHost?: string; fwdProto?: string; host?: string }, e: Record<string, string | undefined> = env) {
  return resolveExternalUrl({
    forwardedHost: headers.fwdHost ?? null,
    forwardedProto: headers.fwdProto ?? null,
    hostHeader: headers.host ?? null,
    nextUrl: new URL('http://internal.local:8080/en/dashboard'),
    env: e,
  });
}

describe('resolveExternalUrl', () => {
  it('believes a forwarded host that is the configured one, and drops the internal port on https', () => {
    expect(resolve({ fwdHost: 'app.example.com:8080', fwdProto: 'https' })).toEqual({ protocol: 'https', host: 'app.example.com' });
  });

  it('ignores a forwarded host the deployment does not serve', () => {
    expect(resolve({ fwdHost: 'evil.example.net', fwdProto: 'https' })).toEqual({ protocol: 'https', host: 'app.example.com' });
  });

  it('ignores a forwarded host that merely contains the configured one', () => {
    expect(resolve({ fwdHost: 'app.example.com.evil.net' }).host).toBe('app.example.com');
    expect(resolve({ fwdHost: 'evilapp.example.com' }).host).toBe('app.example.com');
  });

  it('ignores a Host header the deployment does not serve', () => {
    expect(resolve({ host: 'evil.example.net' }).host).toBe('app.example.com');
  });

  it('takes only http or https from x-forwarded-proto', () => {
    expect(resolve({ fwdHost: 'app.example.com', fwdProto: 'javascript' }).protocol).toBe('https');
    expect(resolve({ fwdHost: 'app.example.com', fwdProto: 'http, https' }).protocol).toBe('http');
  });

  it('uses the first entry of a comma-separated x-forwarded-host', () => {
    expect(resolve({ fwdHost: 'app.example.com, evil.example.net' }).host).toBe('app.example.com');
  });

  it('keeps the port for plain http, which local development relies on', () => {
    const local = { AUTH_URL: 'http://localhost:3000' };
    expect(resolve({ fwdHost: 'localhost:3000', fwdProto: 'http' }, local)).toEqual({ protocol: 'http', host: 'localhost:3000' });
  });

  it('trusts nothing and uses the request URL when no application URL is configured', () => {
    expect(resolve({ fwdHost: 'evil.example.net', fwdProto: 'https' }, {})).toEqual({ protocol: 'http', host: 'internal.local:8080' });
  });

  it('accepts a Vercel deployment host and an AUTH_ALLOWED_HOSTS entry', () => {
    const e = { ...env, VERCEL_URL: 'app-git-feature.vercel.app', AUTH_ALLOWED_HOSTS: 'alias.example.com, other.example.org' };
    expect(resolve({ fwdHost: 'app-git-feature.vercel.app', fwdProto: 'https' }, e).host).toBe('app-git-feature.vercel.app');
    expect(resolve({ fwdHost: 'other.example.org', fwdProto: 'https' }, e).host).toBe('other.example.org');
  });
});

describe('allowedHostnames', () => {
  it('lists the configured host names without ports, lower-cased', () => {
    const names = allowedHostnames({ NEXTAUTH_URL: 'https://App.Example.com:8443', AUTH_ALLOWED_HOSTS: 'Alias.Example.com:3000' });
    expect([...names].sort()).toEqual(['alias.example.com', 'app.example.com']);
  });

  it('ignores an unparseable AUTH_URL and answers false for an unparseable host', () => {
    expect(allowedHostnames({ AUTH_URL: 'not a url' }).size).toBe(0);
    expect(isAllowedHost('exa mple', env)).toBe(false);
  });
});
