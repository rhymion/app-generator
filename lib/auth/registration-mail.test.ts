import { describe, it, expect } from 'vitest';
import { buildRegistrationMail, registrationLocale } from './registration-mail';

describe('registrationLocale', () => {
  it('accepts a configured locale and falls back to the default otherwise', () => {
    expect(registrationLocale('ja')).toBe('ja');
    expect(registrationLocale('en')).toBe('en');
    expect(registrationLocale('xx')).toBe('en');
    expect(registrationLocale('../../etc/passwd')).toBe('en');
    expect(registrationLocale(undefined)).toBe('en');
  });
});

describe('buildRegistrationMail', () => {
  it.each(['en', 'ja'])('puts the sign-up link for a new address in the %s text', async (locale) => {
    const m = await buildRegistrationMail({ kind: 'new', to: 'a@example.com', locale, origin: 'https://app.example', token: 'tok/+=' });
    expect(m.to).toBe('a@example.com');
    expect(m.subject.length).toBeGreaterThan(0);
    expect(m.text).toContain(`https://app.example/${locale}/register/complete?token=tok%2F%2B%3D`);
    expect(m.text).not.toMatch(/\{(app|link)\}/);
  });

  it.each(['en', 'ja'])('gives an existing account holder a sign-in link and no token (%s)', async (locale) => {
    const m = await buildRegistrationMail({ kind: 'existing', to: 'a@example.com', locale, origin: 'https://app.example' });
    expect(m.text).toContain(`https://app.example/${locale}/login`);
    expect(m.text).not.toContain('register/complete');
    expect(m.text).not.toMatch(/\{(app|loginLink)\}/);
  });

  it('refuses to build a sign-up mail without a token', async () => {
    await expect(buildRegistrationMail({ kind: 'new', to: 'a@example.com', locale: 'en', origin: 'https://app.example' })).rejects.toThrow();
  });
});
