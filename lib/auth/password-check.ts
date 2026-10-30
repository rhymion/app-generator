import bcrypt from 'bcryptjs';

// Same cost factor the app uses when it stores a password hash.
const BCRYPT_COST = 10;

let dummyHash: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash('dummy-password-for-timing-equalisation', BCRYPT_COST);
  return dummyHash;
}

/**
 * Compares `password` against a stored hash. When there is no hash to compare
 * (unknown account, or an SSO-only account without a password), a comparison
 * against a throwaway hash of the same cost still runs and the result is
 * discarded, so the "no such credential" and "wrong password" outcomes take
 * comparable time and response timing does not reveal which emails have a
 * password account.
 */
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) {
    await bcrypt.compare(password, await getDummyHash());
    return false;
  }
  return bcrypt.compare(password, storedHash);
}
