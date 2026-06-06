// Handwritten MFA test fixture — not auto-generated.
// Used by cypress/e2e/auth/mfa.cy.ts via cy.task('db:seedMfaUser').
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/app/generated/prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { encryptSecret } from '@/lib/mfa/crypto';
import { generateRecoveryCodes } from '@/lib/mfa/recovery';
import { generateSecret } from 'otplib';
import bcrypt from 'bcryptjs';

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export const MFA_TEST_CREDENTIALS = {
  email: 'mfa-test@example.com',
  password: 'password123',
  name: 'MFA Test User',
};

export type MfaUserSeed = {
  email: string;
  password: string;
  /** Plaintext TOTP secret — pass to cy.task('generateTotp', secret) to get a valid code. */
  secret: string;
  /** One plaintext recovery code — single-use. */
  recoveryCode: string;
};

/**
 * Creates a test user with MFA already enabled and 8 seeded recovery codes.
 * Must be called after cy.task('db:reset') so the default tenant exists.
 */
export async function seedMfaTestUser(): Promise<MfaUserSeed> {
  const secret = generateSecret();
  const encryptedSecret = encryptSecret(secret);
  const codes = await generateRecoveryCodes();
  const hashedPassword = await bcrypt.hash(MFA_TEST_CREDENTIALS.password, 10);
  const userId = createId();

  await prisma.user.create({
    data: {
      id: userId,
      creator_id: userId,
      updater_id: userId,
      email: MFA_TEST_CREDENTIALS.email,
      name: MFA_TEST_CREDENTIALS.name,
      password: hashedPassword,
      mfa_secret: encryptedSecret,
      mfa_enabled: true,
    },
  });

  await prisma.mfa_recovery_code.createMany({
    data: codes.map((c) => ({
      user_id: userId,
      code_hash: c.hash,
    })),
  });

  return {
    email: MFA_TEST_CREDENTIALS.email,
    password: MFA_TEST_CREDENTIALS.password,
    secret,
    recoveryCode: codes[0].plaintext,
  };
}
