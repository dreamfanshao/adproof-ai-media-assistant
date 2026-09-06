import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnv } from "vite";
import { checkModelConfig, scanPublicFiles } from "./check-release.mjs";
import { parseEnv } from "node:util";

// Build from source into a NEW directory. Never reuse stale dist-server output.
const root = process.cwd();
// Match vite.config.ts's UTF-8 BOM fallback without editing the user's env file.
const local = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "")) : {};
const browserEnv = { ...local, ...loadEnv("production", root, ""), ...process.env };
if (!browserEnv.VITE_SUPABASE_URL || !browserEnv.VITE_SUPABASE_PUBLISHABLE_KEY || browserEnv.VITE_API_BASE_URL !== "/api/v1") throw new Error("Production VITE configuration missing; no release created");
const target = resolve(root, ".release", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(target, { recursive: true });
function run(script, args) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Release build failed: ${script}`);
}
run("node_modules/typescript/bin/tsc", ["-b"]);
run("node_modules/typescript/bin/tsc", ["-p", "tsconfig.worker.json"]);
run("node_modules/vite/bin/vite.js", ["build", "--config", "vite.config.ts", "--outDir", join(target, "dist")]);
run("node_modules/typescript/bin/tsc", ["-p", "server/tsconfig.json", "--outDir", join(target, "dist-server")]);
await build({ entryPoints: ["worker/src/index.ts"], bundle: true, platform: "node", format: "esm", packages: "external", target: "node24", outfile: join(target, "dist-worker/index.mjs") });
// Allowlist: no .env*, logs, user uploads, run history, Eval pages or local caches.
for (const file of ["package.json", "package-lock.json", "scripts/check-release.mjs"]) {
  cpSync(join(root, file), join(target, file), { recursive: true });
}
cpSync(join(root, "deploy"), join(target, "deploy"), { recursive: true });
cpSync(join(root, "supabase/migrations"), join(target, "supabase/migrations"), { recursive: true });
mkdirSync(join(target, "agent/data"), { recursive: true });
for (const name of ["skills.json", "model-config.json"]) {
  const file = join(root, "agent/data", name);
  if (!existsSync(file)) throw new Error(`Missing approved runtime configuration: ${name}`);
  const content = readFileSync(file, "utf8");
  JSON.parse(content);
  if (/"(?:apiKey|api_key|password|token|secret)"\s*:/i.test(content)) throw new Error(`Secret field in ${name}; use environment variable names only`);
  writeFileSync(join(target, "agent/data", name), content);
}
const migrations = (await import("node:fs")).readdirSync(join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).map((name) => name.split("_")[0]);
const assetErrors = scanPublicFiles(join(target, "dist"), browserEnv);
const modelErrors = checkModelConfig(JSON.parse(readFileSync(join(target, "agent/data/model-config.json"), "utf8")), browserEnv);
if (assetErrors.length || modelErrors.length) throw new Error([...assetErrors, ...modelErrors].join("; "));
writeFileSync(join(target, "release.json"), JSON.stringify({ builtAt: new Date().toISOString(), node: process.version, supabaseUrl: browserEnv.VITE_SUPABASE_URL, apiBase: browserEnv.VITE_API_BASE_URL, migrations, status: "UNVERIFIED_ON_TARGET" }, null, 2));
console.log(`Release prepared: ${target}`);
console.log("No deployment performed. Run check:release with production environment on the target server.");
