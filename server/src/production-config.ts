/** Fail closed in production; errors contain field names, never secret values. */
export function assertProductionConfig(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") return;
  const invalid = new Set<string>();
  for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "XHS_SESSION_ENCRYPTION_KEY", "REDFOX_API_KEY"]) {
    if (!env[key]?.trim() || /replace_me|your-project/i.test(env[key]!)) invalid.add(key);
  }
  if ((env.API_HOST ?? "127.0.0.1") !== "127.0.0.1") invalid.add("API_HOST");
  for (const origin of (env.WEB_ORIGINS ?? "").split(",")) {
    try {
      const url = new URL(origin.trim());
      if (url.protocol !== "https:" || url.origin !== origin.trim() || /^(localhost|127\.|\[::1\])/.test(url.hostname)) invalid.add("WEB_ORIGINS");
    } catch { invalid.add("WEB_ORIGINS"); }
  }
  try {
    const url = new URL(env.SUPABASE_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password) invalid.add("SUPABASE_URL");
  } catch { invalid.add("SUPABASE_URL"); }
  try {
    const db = new URL(env.DATABASE_URL ?? "");
    // Advisory locks require a direct or SESSION pool connection, not transaction mode.
    if (!/^postgres(ql)?:$/.test(db.protocol) || db.port === "6543" || db.searchParams.get("sslmode") !== "verify-full") invalid.add("DATABASE_URL");
  } catch { invalid.add("DATABASE_URL"); }
  const encoded = env.XHS_SESSION_ENCRYPTION_KEY?.trim() ?? "";
  if (Buffer.from(encoded, /^[0-9a-f]{64}$/i.test(encoded) ? "hex" : "base64").length !== 32) invalid.add("XHS_SESSION_ENCRYPTION_KEY");
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") invalid.add("NODE_TLS_REJECT_UNAUTHORIZED");
  if (invalid.size) throw new Error(`Production configuration invalid: ${[...invalid].join(", ")}`);
}
