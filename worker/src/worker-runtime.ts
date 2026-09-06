import { createHash } from "node:crypto";
import type pg from "pg";

export const WORKER_RUNTIME_VERSION = "2026-09-04.no-wall-clock-search-cap-v1";
const WORKER_SINGLETON_LOCK = "adproof-media-assistant.worker.singleton.v1";

export type RedfoxKeySource = "user" | "system" | "none";

export function redfoxKeyFingerprint(apiKey: string | null | undefined): string | null {
  return apiKey ? createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 10).toUpperCase() : null;
}

export function resolveRedfoxRuntimeKey(userApiKey: string | null | undefined, systemApiKey: string | null | undefined): {
  apiKey: string | undefined;
  source: RedfoxKeySource;
  fingerprint: string | null;
} {
  const user = userApiKey?.trim();
  const system = systemApiKey?.trim();
  const apiKey = user || system || undefined;
  return {
    apiKey,
    source: user ? "user" : system ? "system" : "none",
    fingerprint: redfoxKeyFingerprint(apiKey),
  };
}

export interface WorkerSingletonLease {
  release(): Promise<void>;
}

/**
 * Keeps exactly one current Worker polling the shared queue. PostgreSQL advisory
 * locks are connection-scoped and are released automatically if the process dies.
 */
export async function acquireWorkerSingleton(pool: pg.Pool): Promise<WorkerSingletonLease | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as acquired",
      [WORKER_SINGLETON_LOCK],
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      return null;
    }
    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        try {
          await client.query("select pg_advisory_unlock(hashtext($1))", [WORKER_SINGLETON_LOCK]);
        } finally {
          client.release();
        }
      },
    };
  } catch (error) {
    client.release();
    throw error;
  }
}
