/**
 * Outbound mail (Issue #1092). One function, `sendMail()`, whose transport is
 * chosen from the environment on every call:
 *
 *   SMTP_URL set                       SMTP through nodemailer (smtp:// or smtps://,
 *                                      credentials in the URL)
 *   MAIL_OUTBOX_DIR set, not production each message is written as a JSON file in
 *                                      that directory (development, tests)
 *   neither, not production            the same file outbox in `.mail-outbox/`
 *   neither, production                MailNotConfiguredError: a deployment that
 *                                      needs mail and has no transport fails
 *                                      loudly instead of dropping messages
 *
 * The outbox is refused in production even when MAIL_OUTBOX_DIR is set: a
 * message (a sign-up link, for example) must not land on a server's disk.
 *
 * Nothing about a message is logged here: the body of a confirmation mail is a
 * credential until it is used.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type MailTransportKind = 'smtp' | 'outbox';

export class MailNotConfiguredError extends Error {
  constructor() {
    super('No mail transport is configured: set SMTP_URL (and MAIL_FROM).');
    this.name = 'MailNotConfiguredError';
  }
}

const DEFAULT_OUTBOX_DIR = '.mail-outbox';
const DEFAULT_FROM = 'no-reply@localhost';

type Env = Record<string, string | undefined>;

/** The transport `sendMail()` would use, or null when none may be used. */
export function mailTransportKind(env: Env = process.env): MailTransportKind | null {
  if (env.SMTP_URL) return 'smtp';
  if (env.NODE_ENV !== 'production') return 'outbox';
  return null;
}

/** True when a message can be sent in this environment. */
export function isMailConfigured(env: Env = process.env): boolean {
  return mailTransportKind(env) !== null;
}

function outboxDir(env: Env): string {
  return resolve(env.MAIL_OUTBOX_DIR || DEFAULT_OUTBOX_DIR);
}

export async function sendMail(message: MailMessage, env: Env = process.env): Promise<void> {
  const kind = mailTransportKind(env);
  if (kind === null) throw new MailNotConfiguredError();
  const from = env.MAIL_FROM || DEFAULT_FROM;

  if (kind === 'smtp') {
    const transport = nodemailer.createTransport(env.SMTP_URL as string, {
      // The message is built here from fixed text; never let a field reach a
      // local file or a URL the SMTP client would fetch.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
    return;
  }

  const dir = outboxDir(env);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${randomUUID()}.json`);
  await writeFile(file, JSON.stringify({ from, ...message, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
}
