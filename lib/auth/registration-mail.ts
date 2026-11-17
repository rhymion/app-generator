/**
 * The two messages self-registration with email verification sends (Issue
 * #1092): a sign-up link for an address with no account, and a notice for an
 * address that already has one. Both go out for the same request, so the
 * register response cannot tell a caller which addresses are registered.
 * Texts are the `RegistrationMail` messages of the request's locale.
 */
import { createTranslator } from 'next-intl';
import { routing } from '@/i18n/routing';
import { siteConfig } from '@/lib/site-config';
import type { MailMessage } from '@/lib/mail';

export type RegistrationMailKind = 'new' | 'existing';

export function registrationLocale(value: unknown): string {
  return typeof value === 'string' && (routing.locales as readonly string[]).includes(value) ? value : routing.defaultLocale;
}

async function translatorFor(locale: string) {
  const messages = (await import(`@/messages/${locale}.json`)).default as Record<string, unknown>;
  return createTranslator({ locale, messages: messages as never, namespace: 'RegistrationMail' as never });
}

/**
 * @param origin  scheme and host for links, e.g. `https://app.example.com`
 *                (from resolveExternalUrl: never an unchecked Host header)
 */
export async function buildRegistrationMail(input: {
  kind: RegistrationMailKind;
  to: string;
  locale: string;
  origin: string;
  token?: string;
}): Promise<MailMessage> {
  const t = (await translatorFor(input.locale)) as unknown as (key: string, values?: Record<string, string>) => string;
  const app = siteConfig.title;
  if (input.kind === 'new') {
    if (!input.token) throw new Error('A sign-up link needs a token');
    const link = `${input.origin}/${input.locale}/register/complete?token=${encodeURIComponent(input.token)}`;
    return { to: input.to, subject: t('newSubject', { app }), text: t('newBody', { app, link }) };
  }
  const loginLink = `${input.origin}/${input.locale}/login`;
  return { to: input.to, subject: t('existingSubject', { app }), text: t('existingBody', { app, loginLink }) };
}
