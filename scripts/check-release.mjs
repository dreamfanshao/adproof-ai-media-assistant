import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export function checkModelConfig(config, env) {
  const errors = [];
  for (const name of ["text", "vision"]) {
    const route = config?.[name];
    if (!route?.model || !/^[A-Z][A-Z0-9_]*$/.test(route?.apiKeyEnv ?? "") || !env[route?.apiKeyEnv]?.trim() || /replace_me/i.test(env[route?.apiKeyEnv] ?? "")) errors.push(`model ${name}: configuration/key missing`);
    try {
      const url = new URL(route.baseUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) errors.push(`model ${name}: unsafe URL`);
    } catch { errors.push(`model ${name}: invalid URL`); }
  }
  if (!config?.vision?.supportsVision && !(config?.visionFallbackEnabled && config?.text?.supportsVision)) errors.push("vision: no image-capable route");
  return errors;
}

export function scanPublicFiles(dir, env) {
  const secrets = Object.entries(env).filter(([key, value]) => !key.startsWith("VITE_") && /SECRET|SERVICE_ROLE|DATABASE_URL|ENCRYPTION_KEY|API_KEY/.test(key) && value?.length >= 12).map(([, value]) => value);
  const failures = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = join(current, entry.name);
      if (entry.isSymbolicLink()) { failures.push("public symlink"); continue; }
      if (entry.isDirectory()) walk(file);
      else {
        if (entry.name.startsWith(".env") || entry.name.endsWith(".map")) failures.push("env/source map in public assets");
        const content = readFileSync(file, "utf8");
        if (secrets.some((secret) => content.includes(secret)) || /sb_secret_[A-Za-z0-9_-]{10,}/.test(content)) failures.push("server secret in public assets");
      }
    }
  }
  walk(dir);
  return [...new Set(failures)];
}

export async function checkRelease(root, env, database = false) {
  const errors = [];
  if (Number(process.versions.node.split(".")[0]) !== 24) errors.push("Node.js 24 required for this release recipe");
  if (env.NODE_ENV !== "production") errors.push("NODE_ENV must be production");
  for (const file of ["dist/index.html", "dist-server/server/src/index.js", "dist-worker/index.mjs", "release.json", "agent/data/skills.json", "agent/data/model-config.json"]) {
    if (!existsSync(join(root, file))) errors.push(`missing artifact: ${file}`);
  }
  if (errors.length) return errors;
  const { assertProductionConfig } = await import(pathToFileURL(join(root, "dist-server/server/src/production-config.js")).href);
  try { assertProductionConfig(env); } catch (error) { errors.push(error.message); }
  const model = JSON.parse(readFileSync(join(root, "agent/data/model-config.json"), "utf8"));
  errors.push(...checkModelConfig(model, env), ...scanPublicFiles(join(root, "dist"), env));
  // Validate build-time browser config without printing credentials or modifying files.
  const manifest = JSON.parse(readFileSync(join(root, "release.json"), "utf8"));
  if (manifest.supabaseUrl !== env.SUPABASE_URL || manifest.apiBase !== "/api/v1") errors.push("browser/server Supabase URL mismatch or invalid API base: rebuild with production VITE values");
  if (database && !errors.length) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 8000, query_timeout: 8000, max: 1 });
    try {
      const applied = await pool.query("select version from supabase_migrations.schema_migrations");
      const versions = new Set(applied.rows.map((row) => row.version));
      if (manifest.migrations.some((version) => !versions.has(version))) errors.push("database has unapplied release migrations");
      const rls = await pool.query("select count(*)::int as n from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname where t.schemaname='public' and t.tablename in ('projects','search_tasks','project_creators','knowledge_documents','feedback_tickets') and c.relrowsecurity");
      if (rls.rows[0].n !== 5) errors.push("core tables missing RLS");
      const jobs = await pool.query("select count(*)::int as n from private.jobs where status in ('queued','running') and not terminal");
      if (jobs.rows[0].n > 0) errors.push("active/queued jobs exist: schedule a maintenance window before cutover");
    } catch { errors.push("database verification failed (connection/TLS/migration permissions); no credentials logged"); }
    finally { await pool.end(); }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const errors = await checkRelease(process.cwd(), process.env, process.argv.includes("--database"));
    if (errors.length) { errors.forEach((error) => console.error(`FAIL: ${error}`)); process.exitCode = 1; }
    else console.log("PASS: release configuration/assets verified. Real login, provider calls, Worker and restore tests remain mandatory.");
  } catch {
    console.error("FAIL: release check could not complete; verify artifact/config files");
    process.exitCode = 1;
  }
}
