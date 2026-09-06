// Starts ONLY an isolated compiled API with synthetic credentials. Never starts a Worker.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const release = resolve(process.argv[2] ?? join(".release", readdirSync(".release").sort().at(-1)));
const reserve = createServer();
await new Promise((done) => reserve.listen(0, "127.0.0.1", done));
const port = reserve.address().port;
await new Promise((done) => reserve.close(done));
const child = spawn(process.execPath, [join(release, "dist-server/server/src/index.js")], {
  cwd: release,
  env: {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    NODE_ENV: "production", API_HOST: "127.0.0.1", API_PORT: String(port),
    WEB_ORIGINS: "https://app.example.com", SUPABASE_URL: "https://unit.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_unit_smoke",
    DATABASE_URL: "postgresql://unit:unit@127.0.0.1:1/postgres?sslmode=verify-full",
    XHS_SESSION_ENCRYPTION_KEY: "ab".repeat(32), REDFOX_API_KEY: "unit-smoke-redfox",
    ADPROOF_ANALYTICS_DIR: resolve(".runtime/smoke-analytics"),
  }, stdio: "ignore",
});
let spawnError;
child.on("error", (error) => { spawnError = error; });
try {
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
    if (ready || child.exitCode !== null || spawnError) break;
    await delay(100);
  }
  assert(ready, "compiled production API did not start");
  for (const [path, code] of [["/api/v1/me", 401], ["/api/v1/ready", 503], ["/api/admin/feedback", 404]]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, code, path);
  }
  console.log("PASS: compiled production API boots; health 200; unauthenticated access 401; unavailable DB 503; admin API 404.");
} finally {
  if (child.exitCode === null && !spawnError) {
    const exited = new Promise((done) => child.once("exit", done));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
}
