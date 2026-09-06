import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type pg from "pg";

type EncryptedApiKey = { ciphertext: Buffer; nonce: Buffer; tag: Buffer };

export interface RedfoxCredentialStatus {
  configured: boolean;
  fingerprint: string | null;
  updatedAt: string | null;
}

export interface RedfoxCredentialStore {
  status(userId: string): Promise<RedfoxCredentialStatus>;
  save(userId: string, apiKey: string): Promise<RedfoxCredentialStatus>;
  resolve(userId: string): Promise<string | null>;
}

export class RedfoxApiKeyCipher {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    const trimmed = encodedKey.trim();
    const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
    if (key.length !== 32) throw new Error("XHS_SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes");
    this.key = key;
  }

  encrypt(userId: string, apiKey: string): EncryptedApiKey {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(`redfox-api-key:${userId}`, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
    return { ciphertext, nonce, tag: cipher.getAuthTag() };
  }

  decrypt(userId: string, value: EncryptedApiKey): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, value.nonce);
    decipher.setAAD(Buffer.from(`redfox-api-key:${userId}`, "utf8"));
    decipher.setAuthTag(value.tag);
    return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString("utf8");
  }
}

function fingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 10).toUpperCase();
}

export function createPostgresRedfoxCredentialStore(pool: pg.Pool, encodedEncryptionKey: string): RedfoxCredentialStore {
  const cipher = new RedfoxApiKeyCipher(encodedEncryptionKey);
  return {
    async status(userId) {
      const result = await pool.query(
        "select key_fingerprint, updated_at from private.redfox_api_credentials where user_id = $1",
        [userId],
      );
      const row = result.rows[0];
      return row
        ? { configured: true, fingerprint: String(row.key_fingerprint), updatedAt: new Date(row.updated_at).toISOString() }
        : { configured: false, fingerprint: null, updatedAt: null };
    },

    async save(userId, apiKey) {
      const encrypted = cipher.encrypt(userId, apiKey);
      const keyFingerprint = fingerprint(apiKey);
      const result = await pool.query(
        `insert into private.redfox_api_credentials
           (user_id, encrypted_api_key, encrypted_api_key_nonce, encrypted_api_key_tag, key_fingerprint, updated_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (user_id) do update set
           encrypted_api_key = excluded.encrypted_api_key,
           encrypted_api_key_nonce = excluded.encrypted_api_key_nonce,
           encrypted_api_key_tag = excluded.encrypted_api_key_tag,
           key_fingerprint = excluded.key_fingerprint,
           updated_at = now()
         returning key_fingerprint, updated_at`,
        [userId, encrypted.ciphertext, encrypted.nonce, encrypted.tag, keyFingerprint],
      );
      const row = result.rows[0];
      return { configured: true, fingerprint: String(row.key_fingerprint), updatedAt: new Date(row.updated_at).toISOString() };
    },

    async resolve(userId) {
      const result = await pool.query(
        `select encrypted_api_key, encrypted_api_key_nonce, encrypted_api_key_tag
         from private.redfox_api_credentials where user_id = $1`,
        [userId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return cipher.decrypt(userId, {
        ciphertext: Buffer.from(row.encrypted_api_key),
        nonce: Buffer.from(row.encrypted_api_key_nonce),
        tag: Buffer.from(row.encrypted_api_key_tag),
      });
    },
  };
}
