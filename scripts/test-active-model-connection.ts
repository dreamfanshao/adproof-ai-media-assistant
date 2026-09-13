import process from "node:process";
import pg from "pg";
import { ModelProviderClient } from "../server/src/services/model-provider-service.js";
import { createPostgresModelSettingsStore } from "../server/src/services/model-settings-service.js";

if (!process.argv.includes("--run")) {
  throw new Error("Pass --run to perform one minimal provider request.");
}

const connectionString = process.env.DATABASE_URL;
const encryptionKey = process.env.XHS_SESSION_ENCRYPTION_KEY;
if (!connectionString || !encryptionKey) throw new Error("DATABASE_URL and XHS_SESSION_ENCRYPTION_KEY are required.");

const requestedModel = process.argv.find((value) => value.startsWith("--model="))?.slice("--model=".length);
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15_000 });

try {
  const result = await pool.query(
    `select user_id
     from private.user_model_settings
     where is_active = true and ($1::text is null or model_id = $1)
     order by updated_at desc
     limit 1`,
    [requestedModel || null],
  );
  const userId = result.rows[0]?.user_id;
  if (!userId) throw new Error("No matching active model setting was found.");

  const settings = await createPostgresModelSettingsStore(pool, encryptionKey).resolve(String(userId));
  if (!settings) throw new Error("The active model setting could not be resolved.");

  await new ModelProviderClient().test(settings.provider, settings.modelId, settings.apiKey);
  console.log(`Connection passed: ${settings.provider}/${settings.modelId}`);
} finally {
  await pool.end();
}
