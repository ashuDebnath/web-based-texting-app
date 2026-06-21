/**
 * Local-only storage for cryptographic material. The private identity key
 * and decrypted group keys NEVER touch the network — they live only in
 * this browser's localStorage (and in-memory cache), scoped per logged-in
 * user. This is what makes the chat end-to-end encrypted: the server only
 * ever stores ciphertext and RSA-wrapped keys it cannot unwrap.
 *
 * NOTE: localStorage is used here for simplicity and zero-setup deploy.
 * For a hardened production deployment, consider IndexedDB with a
 * non-extractable CryptoKey, or wrapping the private key with a
 * passphrase-derived key before storage.
 */

const PRIVATE_KEY_PREFIX = 'chatapp:privateKey:';
const GROUP_KEY_CACHE = new Map(); // groupId -> CryptoKey (in-memory only)

export function savePrivateKey(userId, privateKeyB64) {
  localStorage.setItem(PRIVATE_KEY_PREFIX + userId, privateKeyB64);
}

export function loadPrivateKey(userId) {
  return localStorage.getItem(PRIVATE_KEY_PREFIX + userId);
}

export function hasPrivateKey(userId) {
  return localStorage.getItem(PRIVATE_KEY_PREFIX + userId) !== null;
}

export function clearPrivateKey(userId) {
  localStorage.removeItem(PRIVATE_KEY_PREFIX + userId);
}

export function cacheGroupKey(groupId, cryptoKey) {
  GROUP_KEY_CACHE.set(groupId, cryptoKey);
}

export function getCachedGroupKey(groupId) {
  return GROUP_KEY_CACHE.get(groupId) || null;
}

export function clearGroupKeyCache() {
  GROUP_KEY_CACHE.clear();
}
