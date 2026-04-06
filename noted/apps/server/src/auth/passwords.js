import argon2 from 'argon2';

/**
 * Hash a plaintext password using Argon2id.
 * @param {string} password
 * @returns {Promise<string>} encoded hash string
 */
export async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 2,
  });
}

/**
 * Verify a plaintext password against a stored hash.
 * @param {string} hash - stored encoded hash
 * @param {string} password - plaintext candidate
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
