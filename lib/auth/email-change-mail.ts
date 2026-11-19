/**
 * The messages an email change sends with email verification on (Issue #1400): a link to the new
 * address, and a notice to the current address when the change is requested and when it is done.
 * Texts are the `EmailChangeMail` messages of the given locale.
 */
import { createTranslator } from 'next-intl';
import { siteConfig } from '@/lib/site-config';
import type { MailMessage } from '@/lib/mail';

export type EmailChangeMailKind = 'confirm' | 'requested' | 'completed';

async function translatorFor(locale: string) {
  const messages = (await import(`@/messages/${locale}.json`)).default as Record<string, unknown>;
  return createTranslator({ locale, messages: messages as never, namespace: 'EmailChangeMail' as never });
}

/**
 * @param origin  scheme and host for the link (from resolveExternalUrl, never an unchecked Host header)
 * @param locale  an already validated locale (registrationLocale())
 */
export async function buildEmailChangeMail(input: {
  kind: EmailChangeMailKind;
  to: string;
  locale: string;
  origin: string;
  /** `confirm`: the change link token. `requested`: the cancel link token. */
  token?: string;
}): Promise<MailMessage> {
  const t = (await translatorFor(input.locale)) as unknown as (key: string, values?: Record<string, string>) => string;
  const app = siteConfig.title;
  if (input.kind === 'confirm') {
    if (!input.token) throw new Error('An email change link needs a token');
    const link = `${input.origin}/${input.locale}/confirm-email?token=${encodeURIComponent(input.token)}`;
    return { to: input.to, subject: t('confirmSubject', { app }), text: t('confirmBody', { app, link }) };
  }
  if (input.kind === 'requested') {
    if (!input.token) throw new Error('An email change notice needs a cancel token');
    const link = `${input.origin}/${input.locale}/cancel-email-change?token=${encodeURIComponent(input.token)}`;
    return { to: input.to, subject: t('requestedSubject', { app }), text: t('requestedBody', { app, link }) };
  }
  return { to: input.to, subject: t('completedSubject', { app }), text: t('completedBody', { app }) };
}
