// Re-encrypts stored secrets under the current AUTH_SECRET (Issue #1291).
//
//   npm run secrets:reencrypt
//
// Run after rotating AUTH_SECRET, with the old value in AUTH_SECRET_PREVIOUS. Prints how many
// MFA secrets and attachment names were rewritten, already current, or could not be decrypted
// (by id). Exits 1 when any value could not be decrypted: keep AUTH_SECRET_PREVIOUS until that
// is resolved. See docs/knowledge/authentication.md "Rotating AUTH_SECRET".
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pinSslModeVerifyFull } from '../lib/db-url';
import { reencryptStoredSecrets, type ReencryptCounts, type SecretStore } from '../lib/auth/reencrypt-stored-secrets';

function report(label: string, counts: ReencryptCounts): void {
  console.log(`${label}: ${counts.reencrypted} re-encrypted, ${counts.current} already current, ${counts.failed.length} failed`);
  for (const id of counts.failed) console.error(`  could not decrypt ${label} of row ${id}`);
}

async function main(): Promise<number> {
  const rawConnectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!rawConnectionString) throw new Error('DATABASE_URL is required.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pinSslModeVerifyFull(rawConnectionString) }) });
  try {
    const result = await reencryptStoredSecrets(prisma as unknown as SecretStore);
    report('user.mfa_secret', result.mfaSecrets);
    report('attachment.encrypted_original_name', result.attachmentNames);
    const undecryptable = [...result.mfaSecrets.failed, ...result.attachmentNames.failed];
    return undecryptable.length > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
