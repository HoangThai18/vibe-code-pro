import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Tenant secrets at rest (provider keys, OAuth tokens): AES-256-GCM, stored in a *_sealed bytea column as
// version (1 byte) | iv (12) | tag (16) | ciphertext. The 32-byte key comes from a secret manager or KMS
// (an environment variable in examples), never from the database: a database dump alone reveals nothing.
const VERSION = 1;

function checkKey(key: Buffer): void {
  if (key.length !== 32) throw new Error('secret-box: the key must be 32 bytes');
}

export function sealSecret(plaintext: string, key: Buffer): Buffer {
  checkKey(key);
  const iv = randomBytes(12); // never reuse an iv with the same key
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

// Throws if the value was changed, sealed with another key, or is not in this format
export function openSecret(sealed: Buffer, key: Buffer): string {
  checkKey(key);
  if (sealed.length < 29 || sealed[0] !== VERSION) throw new Error('secret-box: unknown format');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
  decipher.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]).toString('utf8');
}
