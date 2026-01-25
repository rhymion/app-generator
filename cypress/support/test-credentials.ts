import * as bcrypt from 'bcryptjs';

/**
 * Test credentials - use these for all testing
 */
export const TEST_CREDENTIALS = {
  email: 'test@example.com',
  password: 'password123', // Plain text password for tests
  name: 'Test User',
};

/**
 * Hash a password for testing
 * @param password - Plain text password
 * @returns Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Get the test password hash
 * This is the same across all environments for consistency
 */
export async function getTestPasswordHash(): Promise<string> {
  return hashPassword(TEST_CREDENTIALS.password);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
