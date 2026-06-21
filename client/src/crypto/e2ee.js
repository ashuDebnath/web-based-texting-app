/**
 * End-to-end encryption layer, built entirely on the browser's native
 * Web Crypto API (SubtleCrypto). No third-party crypto dependency is
 * required, which avoids supply-chain risk and keeps install friction at zero.
 *
 * Design:
 *  - Each user generates an RSA-OAEP keypair (2048-bit) on first signup.
 *    The PRIVATE key never leaves the browser (stored in localStorage,
 *    or better: IndexedDB in a hardened deployment). The PUBLIC key is
 *    uploaded to the server so other users can wrap keys for this user.
 *  - Each group/conversation has one AES-256-GCM symmetric "group key".
 *  - When a group is created, the group key is generated once, then
 *    wrapped (RSA-OAEP encrypted) separately for every member using
 *    that member's public key. The server stores only these wrapped
 *    copies — it can never derive the plaintext group key.
 *  - Every message is encrypted with AES-256-GCM using the group key and
 *    a fresh random IV. The server stores ciphertext + IV only.
 */

const RSA_ALG = { name: 'RSA-OAEP', hash: 'SHA-256' };
const AES_ALG = { name: 'AES-GCM' };

// ---------- Encoding helpers ----------

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function utf8ToBuf(str) {
  return new TextEncoder().encode(str);
}

function bufToUtf8(buf) {
  return new TextDecoder().decode(buf);
}

// ---------- RSA keypair (identity keys) ----------

/**
 * Generates a new RSA-OAEP keypair for a user identity.
 * Returns base64-encoded SPKI (public) and PKCS8 (private) strings.
 */
export async function generateIdentityKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { ...RSA_ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['encrypt', 'decrypt']
  );

  const publicKeyBuf = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKeyBuf = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  return {
    publicKey: bufToBase64(publicKeyBuf),
    privateKey: bufToBase64(privateKeyBuf),
  };
}

export async function importPublicKey(base64Key) {
  return crypto.subtle.importKey('spki', base64ToBuf(base64Key), RSA_ALG, true, ['encrypt']);
}

export async function importPrivateKey(base64Key) {
  return crypto.subtle.importKey('pkcs8', base64ToBuf(base64Key), RSA_ALG, true, ['decrypt']);
}

// ---------- AES group key (per-conversation symmetric key) ----------

export async function generateGroupKey() {
  const key = await crypto.subtle.generateKey({ ...AES_ALG, length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  return key;
}

export async function exportGroupKeyRaw(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufToBase64(raw);
}

export async function importGroupKeyRaw(base64Key) {
  return crypto.subtle.importKey('raw', base64ToBuf(base64Key), AES_ALG, true, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Wraps (encrypts) a raw AES group key with a recipient's RSA public key,
 * so it can be safely stored server-side as `wrapped_group_key`.
 */
export async function wrapGroupKeyForUser(groupKey, recipientPublicKeyB64) {
  const rawKey = await crypto.subtle.exportKey('raw', groupKey);
  const publicKey = await importPublicKey(recipientPublicKeyB64);
  const wrapped = await crypto.subtle.encrypt(RSA_ALG, publicKey, rawKey);
  return bufToBase64(wrapped);
}

/**
 * Unwraps a group key using the current user's own private key.
 */
export async function unwrapGroupKey(wrappedKeyB64, myPrivateKeyB64) {
  const privateKey = await importPrivateKey(myPrivateKeyB64);
  const rawKey = await crypto.subtle.decrypt(RSA_ALG, privateKey, base64ToBuf(wrappedKeyB64));
  return crypto.subtle.importKey('raw', rawKey, AES_ALG, true, ['encrypt', 'decrypt']);
}

// ---------- Message encryption (AES-256-GCM) ----------

/**
 * Encrypts plaintext with the group's AES key. Returns base64 ciphertext
 * and IV, ready to send to the server. GCM's auth tag is appended to the
 * ciphertext automatically by SubtleCrypto, so a separate authTag field
 * isn't required, but we keep the field in the data model for portability
 * with other crypto backends.
 */
export async function encryptText(plaintext, groupKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { ...AES_ALG, iv },
    groupKey,
    utf8ToBuf(plaintext)
  );
  return {
    ciphertext: bufToBase64(ciphertextBuf),
    iv: bufToBase64(iv),
  };
}

export async function decryptText(ciphertextB64, ivB64, groupKey) {
  const plaintextBuf = await crypto.subtle.decrypt(
    { ...AES_ALG, iv: base64ToBuf(ivB64) },
    groupKey,
    base64ToBuf(ciphertextB64)
  );
  return bufToUtf8(plaintextBuf);
}

/**
 * Encrypts an arbitrary file (ArrayBuffer) with the group key. Used for
 * file-sharing: the encrypted bytes are uploaded as a multipart blob, and
 * the filename is separately encrypted as a small text payload.
 */
export async function encryptFile(arrayBuffer, groupKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await crypto.subtle.encrypt({ ...AES_ALG, iv }, groupKey, arrayBuffer);
  return {
    ciphertextBlob: new Blob([ciphertextBuf]),
    iv: bufToBase64(iv),
  };
}

export async function decryptFile(ciphertextArrayBuffer, ivB64, groupKey) {
  const plaintextBuf = await crypto.subtle.decrypt(
    { ...AES_ALG, iv: base64ToBuf(ivB64) },
    groupKey,
    ciphertextArrayBuffer
  );
  return plaintextBuf;
}

export { bufToBase64, base64ToBuf, utf8ToBuf, bufToUtf8 };
