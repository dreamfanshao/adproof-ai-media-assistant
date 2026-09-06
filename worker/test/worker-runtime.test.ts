import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { acquireWorkerSingleton, redfoxKeyFingerprint, resolveRedfoxRuntimeKey } from "../src/worker-runtime.js";

test("user RedFox key overrides the system key and exposes only a fingerprint", () => {
  const selected = resolveRedfoxRuntimeKey("user-secret-key", "system-secret-key");
  assert.equal(selected.apiKey, "user-secret-key");
  assert.equal(selected.source, "user");
  assert.equal(selected.fingerprint, redfoxKeyFingerprint("user-secret-key"));
  assert.ok(!JSON.stringify({ source: selected.source, fingerprint: selected.fingerprint }).includes("user-secret-key"));
});

test("system RedFox key is used only when the user has no override", () => {
  const selected = resolveRedfoxRuntimeKey(null, "system-secret-key");
  assert.equal(selected.apiKey, "system-secret-key");
  assert.equal(selected.source, "system");
});

test("duplicate Worker exits when the PostgreSQL singleton lock is already held", async () => {
  let released = false;
  const client = {
    async query() { return { rows: [{ acquired: false }] }; },
    release() { released = true; },
  };
  const pool = { async connect() { return client; } } as unknown as pg.Pool;
  assert.equal(await acquireWorkerSingleton(pool), null);
  assert.equal(released, true);
});
