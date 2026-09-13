import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type pg from "pg";

export const MODEL_PROVIDER_IDS = ["anthropic", "openai", "deepseek", "qwen", "glm"] as const;
export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number];

type EncryptedApiKey = { ciphertext: Buffer; nonce: Buffer; tag: Buffer };

export interface ModelProviderStatus {
  provider: ModelProviderId;
  configured: boolean;
  active: boolean;
  modelId: string | null;
  fingerprint: string | null;
  updatedAt: string | null;
}

export interface ResolvedModelSettings {
  provider: ModelProviderId;
  modelId: string;
  baseUrl: string;
  apiKey: string;
}

export interface ModelSettingsStore {
  status(userId: string): Promise<ModelProviderStatus[]>;
  save(userId: string, input: { provider: ModelProviderId; modelId: string; baseUrl: string; apiKey?: string }): Promise<ModelProviderStatus[]>;
  resolve(userId: string): Promise<ResolvedModelSettings | null>;
  resolveKey(userId: string, provider: ModelProviderId): Promise<string | null>;
}

export class ModelApiKeyCipher {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    const trimmed = encodedKey.trim();
    const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
    if (key.length !== 32) throw new Error("XHS_SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes");
    this.key = key;
  }

  encrypt(userId: string, provider: ModelProviderId, apiKey: string): EncryptedApiKey {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(`model-api-key:${userId}:${provider}`, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
    return { ciphertext, nonce, tag: cipher.getAuthTag() };
  }

  decrypt(userId: string, provider: ModelProviderId, value: EncryptedApiKey): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, value.nonce);
    decipher.setAAD(Buffer.from(`model-api-key:${userId}:${provider}`, "utf8"));
    decipher.setAuthTag(value.tag);
    return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString("utf8");
  }
}

function fingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 10).toUpperCase();
}

function mapStatus(row: Record<string, unknown>): ModelProviderStatus {
  return {
    provider: String(row.provider) as ModelProviderId,
    configured: true,
    active: Boolean(row.is_active),
    modelId: String(row.model_id),
    fingerprint: String(row.key_fingerprint),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function createPostgresModelSettingsStore(pool: pg.Pool, encodedEncryptionKey: string): ModelSettingsStore {
  const cipher = new ModelApiKeyCipher(encodedEncryptionKey);

  async function rowsFor(userId: string): Promise<ModelProviderStatus[]> {
    const result = await pool.query(
      `select provider, model_id, key_fingerprint, is_active, updated_at
       from private.user_model_settings where user_id = $1 order by provider`,
      [userId],
    );
    return result.rows.map(mapStatus);
  }

  async function encryptedKey(userId: string, provider: ModelProviderId): Promise<string | null> {
    const result = await pool.query(
      `select encrypted_api_key, encrypted_api_key_nonce, encrypted_api_key_tag
       from private.user_model_settings where user_id = $1 and provider = $2`,
      [userId, provider],
    );
    const row = result.rows[0];
    if (!row) return null;
    return cipher.decrypt(userId, provider, {
      ciphertext: Buffer.from(row.encrypted_api_key),
      nonce: Buffer.from(row.encrypted_api_key_nonce),
      tag: Buffer.from(row.encrypted_api_key_tag),
    });
  }

  return {
    status: rowsFor,

    async save(userId, input) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`model-settings:${userId}`]);
        const existing = await client.query(
          `select encrypted_api_key, encrypted_api_key_nonce, encrypted_api_key_tag, key_fingerprint
           from private.user_model_settings where user_id = $1 and provider = $2 for update`,
          [userId, input.provider],
        );
        const current = existing.rows[0];
        const encrypted = input.apiKey ? cipher.encrypt(userId, input.provider, input.apiKey) : null;
        if (!encrypted && !current) throw new Error("MODEL_API_KEY_REQUIRED");
        await client.query("update private.user_model_settings set is_active = false where user_id = $1", [userId]);
        await client.query(
          `insert into private.user_model_settings
             (user_id, provider, model_id, base_url, encrypted_api_key, encrypted_api_key_nonce,
              encrypted_api_key_tag, key_fingerprint, is_active, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, true, now())
           on conflict (user_id, provider) do update set
             model_id = excluded.model_id,
             base_url = excluded.base_url,
             encrypted_api_key = excluded.encrypted_api_key,
             encrypted_api_key_nonce = excluded.encrypted_api_key_nonce,
             encrypted_api_key_tag = excluded.encrypted_api_key_tag,
             key_fingerprint = excluded.key_fingerprint,
             is_active = true,
             updated_at = now()`,
          [
            userId,
            input.provider,
            input.modelId,
            input.baseUrl,
            encrypted?.ciphertext ?? current.encrypted_api_key,
            encrypted?.nonce ?? current.encrypted_api_key_nonce,
            encrypted?.tag ?? current.encrypted_api_key_tag,
            input.apiKey ? fingerprint(input.apiKey) : current.key_fingerprint,
          ],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      return rowsFor(userId);
    },

    async resolve(userId) {
      const result = await pool.query(
        `select provider, model_id, base_url, encrypted_api_key, encrypted_api_key_nonce, encrypted_api_key_tag
         from private.user_model_settings where user_id = $1 and is_active = true limit 1`,
        [userId],
      );
      const row = result.rows[0];
      if (!row) return null;
      const provider = String(row.provider) as ModelProviderId;
      return {
        provider,
        modelId: String(row.model_id),
        baseUrl: String(row.base_url),
        apiKey: cipher.decrypt(userId, provider, {
          ciphertext: Buffer.from(row.encrypted_api_key),
          nonce: Buffer.from(row.encrypted_api_key_nonce),
          tag: Buffer.from(row.encrypted_api_key_tag),
        }),
      };
    },

    resolveKey: encryptedKey,
  };
}
