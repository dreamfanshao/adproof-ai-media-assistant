import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/lib/database.types.js";
import type { PlatformConnection } from "./xhs-connection-service.js";

export interface EncryptedSessionState {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

export interface StoredXhsSession {
  connection: PlatformConnection;
  encryptedState: EncryptedSessionState | null;
}

export interface XhsSessionRepository {
  load(userId: string): Promise<StoredXhsSession | null>;
  save(
    userId: string,
    connection: PlatformConnection,
    encryptedState: EncryptedSessionState | null,
  ): Promise<StoredXhsSession>;
  remove(userId: string): Promise<void>;
}

export class XhsSessionCipher {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    const trimmed = encodedKey.trim();
    const key = /^[0-9a-f]{64}$/i.test(trimmed)
      ? Buffer.from(trimmed, "hex")
      : Buffer.from(trimmed, "base64");
    if (key.length !== 32) {
      throw new Error("XHS_SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes");
    }
    this.key = key;
  }

  encrypt(storageState: unknown): EncryptedSessionState {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const plaintext = Buffer.from(JSON.stringify(storageState), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { ciphertext, nonce, tag: cipher.getAuthTag() };
  }

  decrypt(encryptedState: EncryptedSessionState): unknown {
    const decipher = createDecipheriv("aes-256-gcm", this.key, encryptedState.nonce);
    decipher.setAuthTag(encryptedState.tag);
    const plaintext = Buffer.concat([
      decipher.update(encryptedState.ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  }
}

function encodeBytea(value: Buffer | null): string | null {
  return value ? `\\x${value.toString("hex")}` : null;
}

function decodeBytea(value: string | null): Buffer | null {
  if (!value) return null;
  if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  return Buffer.from(value, "base64");
}

export function createSupabaseXhsSessionRepository(
  supabaseUrl: string,
  serviceRoleKey: string,
): XhsSessionRepository {
  const client = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const toStoredSession = (
    row: Database["public"]["Tables"]["platform_sessions"]["Row"],
  ): StoredXhsSession => {
    const ciphertext = decodeBytea(row.encrypted_state);
    const nonce = decodeBytea(row.encrypted_state_nonce);
    const tag = decodeBytea(row.encrypted_state_tag);
    const encryptedState = ciphertext && nonce && tag ? { ciphertext, nonce, tag } : null;
    return {
      connection: {
        id: row.id,
        task_id: row.task_id,
        platform: "xiaohongshu",
        status: row.status,
        qr_image_url: null,
        qr_expires_at: row.qr_expires_at,
        session_expires_at: row.session_expires_at,
        last_verified_at: row.last_verified_at,
        account_display_name: row.account_display_name,
        account_handle_masked: row.account_handle_masked,
        avatar_url: null,
        message_code: row.message_code,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      encryptedState,
    };
  };

  return {
    async load(userId) {
      const { data, error } = await client
        .from("platform_sessions")
        .select("*")
        .eq("user_id", userId)
        .eq("platform", "xiaohongshu")
        .maybeSingle();
      if (error) throw new Error("Unable to load encrypted XHS session");
      return data ? toStoredSession(data) : null;
    },

    async save(userId, connection, encryptedState) {
      const payload: Database["public"]["Tables"]["platform_sessions"]["Insert"] = {
        user_id: userId,
        platform: "xiaohongshu",
        status: connection.status,
        task_id: null,
        encrypted_state: encodeBytea(encryptedState?.ciphertext ?? null),
        encrypted_state_nonce: encodeBytea(encryptedState?.nonce ?? null),
        encrypted_state_tag: encodeBytea(encryptedState?.tag ?? null),
        qr_storage_path: null,
        qr_expires_at: connection.qr_expires_at,
        session_expires_at: connection.session_expires_at,
        last_verified_at: connection.last_verified_at,
        account_display_name: connection.account_display_name,
        account_handle_masked: connection.account_handle_masked,
        message_code: connection.message_code,
      };
      const { data, error } = await client
        .from("platform_sessions")
        .upsert(payload, { onConflict: "user_id,platform" })
        .select("*")
        .single();
      if (error || !data) throw new Error("Unable to save encrypted XHS session");
      const stored = toStoredSession(data);
      stored.connection.task_id = connection.task_id;
      return stored;
    },

    async remove(userId) {
      const { error } = await client
        .from("platform_sessions")
        .delete()
        .eq("user_id", userId)
        .eq("platform", "xiaohongshu");
      if (error) throw new Error("Unable to remove encrypted XHS session");
    },
  };
}
