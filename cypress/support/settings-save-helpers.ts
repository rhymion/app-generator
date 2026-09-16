// Handwritten settings-save test fixtures — not auto-generated.
// Used by cypress/e2e/auth/settings_avatar_save.cy.ts (app-generator#576
// regression coverage: saving the settings edit form -- with or without an
// avatar change -- must not throw a false CONFLICT and must never wipe a
// write-only field (password/api_key) the user did not touch).
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/app/generated/prisma/client';
import { createId } from '@paralleldrive/cuid2';
import bcrypt from 'bcryptjs';

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export const SETTINGS_SAVE_TEST_CREDENTIALS = {
  email: 'settings-save-test@example.com',
  password: 'password123',
  name: 'Settings Save Test User',
};

export const SSO_SETTINGS_SAVE_TEST = {
  email: 'sso-settings-save-test@example.com',
  name: 'SSO Settings Save Test User',
};

/** Same ownership-grant pattern as mfa-helpers.ts's grantOwnSettingAccess --
 * `setting` is x-self-only with no ordinary permission grant, so a non-admin
 * user's own setting.read/update is reached via the special-cased 'Creator'
 * role (lib/authz.ts SPECIAL_ROLE_NAMES), resolved by ownership. */
async function grantOwnSettingAccess(userId: string): Promise<void> {
  const role = await prisma.role.create({
    data: { name: 'Creator', creator_id: userId, updater_id: userId },
  });
  await prisma.permission.create({
    data: {
      name: 'setting',
      role_id: role.id,
      create: false,
      read: true,
      update: true,
      delete: false,
      import: false,
      creator_id: userId,
      updater_id: userId,
    },
  });
}

async function seedStartingAvatar(userId: string): Promise<string> {
  const att = await prisma.attachment.create({
    data: {
      id: createId(),
      name: 'starting-avatar.png',
      path: 'https://example.com/starting-avatar.png',
      type: 'image',
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { image_id: att.id } });
  return att.id;
}

export type SettingsSaveUserSeed = {
  email: string;
  password: string;
  userId: string;
  /** id of the attachment the account already has as its avatar. */
  startingImageId: string;
};

/**
 * Credentials account seeded with BOTH a real (non-null) password and a
 * real (non-null) api_key, own-setting access, and a pre-existing avatar
 * -- so a plain Save (no field changes) exercises write-only-field
 * comparison in assertNotStale() on BOTH fields, and remove/replace flows
 * have a starting image to act on.
 */
export async function seedSettingsSaveTestUser(): Promise<SettingsSaveUserSeed> {
  const hashedPassword = await bcrypt.hash(SETTINGS_SAVE_TEST_CREDENTIALS.password, 10);
  const userId = createId();
  await prisma.user.create({
    data: {
      id: userId,
      creator_id: userId,
      updater_id: userId,
      email: SETTINGS_SAVE_TEST_CREDENTIALS.email,
      name: SETTINGS_SAVE_TEST_CREDENTIALS.name,
      password: hashedPassword,
      api_key: `mk_${createId()}`,
    },
  });
  const startingImageId = await seedStartingAvatar(userId);
  await grantOwnSettingAccess(userId);
  return {
    email: SETTINGS_SAVE_TEST_CREDENTIALS.email,
    password: SETTINGS_SAVE_TEST_CREDENTIALS.password,
    userId,
    startingImageId,
  };
}

export type SsoSettingsSaveUserSeed = {
  email: string;
  userId: string;
  startingImageId: string;
};

/**
 * SSO-provisioned account (password = null, api_key = null, as any real
 * Google sign-in produces) with a pre-existing avatar -- parity coverage
 * confirming app-generator#576's CONFLICT symptom is not specific to the
 * credentials path (unlike #563, which WAS SSO-specific).
 */
export async function seedSsoSettingsSaveTestUser(): Promise<SsoSettingsSaveUserSeed> {
  const userId = createId();
  await prisma.user.create({
    data: {
      id: userId,
      creator_id: userId,
      updater_id: userId,
      email: SSO_SETTINGS_SAVE_TEST.email,
      name: SSO_SETTINGS_SAVE_TEST.name,
      password: null,
      api_key: null,
    },
  });
  const startingImageId = await seedStartingAvatar(userId);
  await grantOwnSettingAccess(userId);
  return { email: SSO_SETTINGS_SAVE_TEST.email, userId, startingImageId };
}

export type CredentialState = { passwordIsNull: boolean; apiKeyIsNull: boolean; passwordHash: string | null };

/** Reads the raw persisted password/api_key state for a user, for
 * asserting a save that didn't touch these fields left them untouched
 * (app-generator#576's second, more severe defect: an untouched
 * write-only field being coerced to NULL on every save). */
export async function getCredentialState(email: string): Promise<CredentialState> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { password: true, api_key: true },
  });
  return {
    passwordIsNull: user.password === null,
    apiKeyIsNull: user.api_key === null,
    passwordHash: user.password,
  };
}
