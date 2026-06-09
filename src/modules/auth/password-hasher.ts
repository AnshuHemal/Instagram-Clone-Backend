import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export class PasswordHasher {
  /**
   * Generates a secure hash using scrypt.
   * Format: salt:hash
   */
  static hash(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Verifies a password against a stored scrypt hash.
   */
  static verify(password: string, storedHash: string): boolean {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    const key = scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(hash, 'hex');
    return timingSafeEqual(key, keyBuffer);
  }
}
