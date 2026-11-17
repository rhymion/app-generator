/**
 * The message a password reset request sends (Issue #1282): a link for an address that has a
 * password account. Nothing is sent for any other address, and the request answers the same
 * either way. Texts are the `PasswordResetMail` messages of the request's locale.
 */
import { createTranslator } from 'next-intl';
import { siteConfig } from '@/lib/site-config';
import type { MailMessage } from '@/lib/mail';

async function translatorFor(locale: string) {
  const messages = (await import(`@/messages/${locale}.json`)).default as Record<string, unknown>;
  return createTranslator({ locale, messages: messages as never, namespace: 'PasswordResetMail' as never });
}

/**
 * @param origin  scheme and host for the link (from resolveExternalUrl, never an unchecked Host header)
 * @param locale  an already validated locale (registrationLocale())
 */
export async function buildPasswordResetMail(input: { to: string; locale: string; origin: string; token: string }): Promise<MailMessage> {
  const t = (await translatorFor(input.locale)) as unknown as (key: string, values?: Record<string, string>) => string;
  const app = siteConfig.title;
  const link = `${input.origin}/${input.locale}/reset-password?token=${encodeURIComponent(input.token)}`;
  return { to: input.to, subject: t('subject', { app }), text: t('body', { app, link }) };
}
