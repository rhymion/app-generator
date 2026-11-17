import bcrypt from 'bcryptjs';
import { bcryptCost } from './bcrypt-cost';

// The throwaway hash uses the cost the app stores password hashes with (BCRYPT_COST), so a
// comparison against it takes as long as one against a real hash.
let dummyHash: { cost: number; hash: Promise<string> } | undefined;

function getDummyHash(): Promise<string> {
  const cost = bcryptCost();
  if (dummyHash?.cost !== cost) {
    dummyHash = { cost, hash: bcrypt.hash('dummy-password-for-timing-equalisation', cost) };
  }
  return dummyHash.hash;
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
