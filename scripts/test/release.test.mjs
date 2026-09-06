import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkModelConfig, scanPublicFiles } from "../check-release.mjs";

mkdirSync(".runtime", { recursive: true });
const dir = mkdtempSync(resolve(".runtime", "release-test-"));
await build({ entryPoints: ["worker/src/environment.ts"], bundle: true, platform: "node", format: "esm", packages: "external", outfile: join(dir, "env.mjs") });
await build({ entryPoints: ["server/src/production-config.ts"], bundle: true, platform: "node", format: "esm", outfile: join(dir, "guard.mjs") });
const { loadWorkerEnv } = await import(pathToFileURL(join(dir, "env.mjs")).href);
const { assertProductionConfig } = await import(pathToFileURL(join(dir, "guard.mjs")).href);
const env = {
  NODE_ENV: "production", SUPABASE_URL: "https://unit.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit", SUPABASE_SERVICE_ROLE_KEY: "unit-private-service-value",
  DATABASE_URL: "postgresql://unit:unit@db.example.com:5432/postgres?sslmode=verify-full",
  XHS_SESSION_ENCRYPTION_KEY: "ab".repeat(32), REDFOX_API_KEY: "unit-redfox-value",
  API_HOST: "127.0.0.1", WEB_ORIGINS: "https://app.example.com",
};
test("valid production config accepted", () => assert.doesNotThrow(() => assertProductionConfig(env)));
for (const field of ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "REDFOX_API_KEY", "WEB_ORIGINS"]) {
  test(`production fails closed without ${field}`, () => assert.throws(() => assertProductionConfig({ ...env, [field]: "" }), new RegExp(field)));
}
test("reject transaction pool and insecure TLS", () => {
  assert.throws(() => assertProductionConfig({ ...env, DATABASE_URL: env.DATABASE_URL.replace("5432", "6543") }), /DATABASE_URL/);
  assert.throws(() => assertProductionConfig({ ...env, DATABASE_URL: env.DATABASE_URL.replace("verify-full", "require") }), /DATABASE_URL/);
  assert.throws(() => assertProductionConfig({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: "0" }), /TLS/);
});
test("reject public API binding and HTTP origin", () => {
  assert.throws(() => assertProductionConfig({ ...env, API_HOST: "0.0.0.0" }), /API_HOST/);
  assert.throws(() => assertProductionConfig({ ...env, WEB_ORIGINS: "http://localhost:5173" }), /WEB_ORIGINS/);
});
test("production ignores local file and does not require it", () => {
  const file = join(dir, "local-test.txt");
  writeFileSync(file, "REDFOX_API_KEY=wrong-local-value\n");
  assert.equal(loadWorkerEnv(env, file).REDFOX_API_KEY, env.REDFOX_API_KEY);
  assert.equal(loadWorkerEnv(env, join(dir, "absent")).DATABASE_URL, env.DATABASE_URL);
});
test("development still reloads local keys with quotes/comments parsed", () => {
  const file = join(dir, "development-test.txt");
  writeFileSync(file, 'REDFOX_API_KEY="first-value" # comment\n');
  assert.equal(loadWorkerEnv({ NODE_ENV: "development" }, file).REDFOX_API_KEY, "first-value");
  writeFileSync(file, 'REDFOX_API_KEY="second-value"\n');
  assert.equal(loadWorkerEnv({ NODE_ENV: "development" }, file).REDFOX_API_KEY, "second-value");
});
test("environment errors never disclose values", () => {
  try { assertProductionConfig({ ...env, DATABASE_URL: "postgresql://sensitive-password" }); }
  catch (error) { assert(!error.message.includes("sensitive-password")); }
});
test("public asset scan catches secret leak without returning the secret", () => {
  const assets = join(dir, "assets"); mkdirSync(assets);
  writeFileSync(join(assets, "main.js"), `const x='${env.SUPABASE_SERVICE_ROLE_KEY}'`);
  assert.deepEqual(scanPublicFiles(assets, env), ["server secret in public assets"]);
});
test("model readiness uses configured environment name, not hardcoded provider", () => {
  const route = { model: "test-model", baseUrl: "https://provider.example.com", apiKeyEnv: "CUSTOM_KEY", supportsVision: true };
  assert.deepEqual(checkModelConfig({ text: route, vision: route }, { CUSTOM_KEY: "unit-value" }), []);
  assert.equal(checkModelConfig({ text: route, vision: route }, {}).length, 2);
});
test("deployment recipe excludes public Eval and disables SSE buffering", () => {
  const nginx = readFileSync("deploy/nginx.conf.template", "utf8");
  assert(nginx.includes("admin|eval|agent"));
  assert(nginx.includes("proxy_buffering off"));
  assert(!nginx.includes(":3081"));
  assert(nginx.includes("X-Forwarded-For $remote_addr"));
  const unit = readFileSync("deploy/adproof-worker.service", "utf8");
  assert(unit.includes("User=adproof"));
  assert(!unit.includes("tsx"));
});
