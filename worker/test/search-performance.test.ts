import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrderedPrefetch } from "../src/ordered-prefetch.js";
import { normalizeProfile, RedfoxXhsClient } from "../src/redfox-xhs-client.js";

test("ordered lookahead runs four preparations concurrently without reordering or speculative continuation", async () => {
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const releases = new Map<number, () => void>();
  const prefetch = new OrderedPrefetch([0, 1, 2, 3, 4, 5], 4, async (n) => {
    started.push(n); peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => releases.set(n, resolve));
    active -= 1;
    return n;
  });
  const first = prefetch.take(0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3]);
  for (const n of [3, 2, 1, 0]) releases.get(n)!();
  assert.equal(await first, 0);
  assert.equal(peak, 4);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3], "cancel/stop must not start more work");
  const second = prefetch.take(1);
  assert.equal(await second, 1);
  releases.get(4)!();
});

test("lookahead observes failures even when cancellation skips their consumption", async () => {
  const prefetch = new OrderedPrefetch([0, 1], 2, async (n) => {
    if (n) throw new Error("upstream failed");
    return n;
  });
  assert.equal(await prefetch.take(0), 0);
  await assert.rejects(prefetch.take(1), /upstream failed/);
});

test("realtime small-account profile uses realtime endpoint and preserves exact followers", async () => {
  const originalFetch = globalThis.fetch;
  const originalDir = process.env.ADPROOF_ANALYTICS_DIR;
  process.env.ADPROOF_ANALYTICS_DIR = mkdtempSync(join(tmpdir(), "adproof-profile-test-"));
  const calls: Array<{ url: string; body: unknown; time: number }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), time: Date.now() });
    return Response.json({ code: 2000, data: { uid: "profile-test-147", nickname: "Small creator", fansCount: 147 } });
  };
  try {
    const client = new RedfoxXhsClient({ apiKey: "test", baseUrl: "https://test.invalid", searchPath: "/story/api/xhs/ability/searchWork", requestDelayMs: 300 });
    const results = await Promise.all([client.getUserInfo("profile-test-147"), client.getUserInfo("profile-test-769"), client.getUserInfo("profile-test-38")]);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.url.endsWith("/story/api/xhs/ability/accountDetail")));
    assert.deepEqual(calls[0].body, { userId: "profile-test-147" });
    assert.ok(calls[1].time - calls[0].time >= 250);
    assert.ok(calls[2].time - calls[1].time >= 250, "concurrency must preserve request spacing");
    assert.equal(normalizeProfile(results[0].data as Record<string, unknown>)?.fields.followers, 147);
    await client.getUserInfo("profile-test-147");
    assert.equal(calls.length, 3, "repeat profile reads use cache");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDir === undefined) delete process.env.ADPROOF_ANALYTICS_DIR;
    else process.env.ADPROOF_ANALYTICS_DIR = originalDir;
  }
});

test("normalization distinguishes small counts, true zero, and unavailable counts", () => {
  for (const value of [0, 38, 147, 769, 999, 1000]) {
    assert.equal(normalizeProfile({ uid: "u", fansCount: value })?.fields.followers, value);
  }
  assert.equal(normalizeProfile({ uid: "u", fansCount: "769" })?.fields.followers, 769);
  assert.equal(normalizeProfile({ uid: "u", fansCount: null })?.fields.followers, null);
  assert.equal(normalizeProfile({ uid: "u" })?.fields.followers, null);
});
