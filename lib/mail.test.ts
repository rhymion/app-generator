import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createTransport, transportSend } = vi.hoisted(() => ({ createTransport: vi.fn(), transportSend: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

import { isMailConfigured, mailTransportKind, MailNotConfiguredError, sendMail } from './mail';

const message = { to: 'someone@example.com', subject: 'Hello', text: 'Body with https://app.example/x?token=abc' };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mail-outbox-'));
  createTransport.mockReset().mockReturnValue({ sendMail: transportSend });
  transportSend.mockReset().mockResolvedValue({});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('mail transport selection', () => {
  it('uses SMTP when SMTP_URL is set, in any environment', () => {
    expect(mailTransportKind({ SMTP_URL: 'smtp://u:p@mail:587', NODE_ENV: 'production' })).toBe('smtp');
    expect(mailTransportKind({ SMTP_URL: 'smtp://mail:25', NODE_ENV: 'development' })).toBe('smtp');
  });

  it('uses the file outbox outside production', () => {
    expect(mailTransportKind({ NODE_ENV: 'development' })).toBe('outbox');
    expect(mailTransportKind({ NODE_ENV: 'test', MAIL_OUTBOX_DIR: '/tmp/x' })).toBe('outbox');
  });

  it('has no transport in production without SMTP_URL, even with MAIL_OUTBOX_DIR', () => {
    expect(mailTransportKind({ NODE_ENV: 'production' })).toBeNull();
    expect(mailTransportKind({ NODE_ENV: 'production', MAIL_OUTBOX_DIR: '/tmp/x' })).toBeNull();
    expect(isMailConfigured({ NODE_ENV: 'production', MAIL_OUTBOX_DIR: '/tmp/x' })).toBe(false);
  });
});

describe('sendMail', () => {
  it('throws MailNotConfiguredError in production without SMTP_URL and writes nothing', async () => {
    await expect(sendMail(message, { NODE_ENV: 'production', MAIL_OUTBOX_DIR: dir })).rejects.toBeInstanceOf(MailNotConfiguredError);
    expect(readdirSync(dir)).toHaveLength(0);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends through SMTP with file and URL access disabled', async () => {
    await sendMail(message, { NODE_ENV: 'production', SMTP_URL: 'smtps://u:p@mail.example:465', MAIL_FROM: 'App <app@example.com>' });
    expect(createTransport).toHaveBeenCalledWith('smtps://u:p@mail.example:465', { disableFileAccess: true, disableUrlAccess: true });
    expect(transportSend).toHaveBeenCalledWith({ from: 'App <app@example.com>', ...message });
  });

  it('writes one owner-only JSON file per message to the outbox', async () => {
    await sendMail(message, { NODE_ENV: 'development', MAIL_OUTBOX_DIR: dir });
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const saved = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
    expect(saved).toMatchObject({ ...message, from: 'no-reply@localhost' });
    expect(statSync(join(dir, files[0])).mode & 0o077).toBe(0);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('logs nothing about the message', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await sendMail(message, { NODE_ENV: 'development', MAIL_OUTBOX_DIR: dir });
    await sendMail(message, { SMTP_URL: 'smtp://mail:25' });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('token=abc');
      spy.mockRestore();
    }
  });
});
