import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 15_000,
});

const client = await pool.connect();

try {
  const before = await client.query(`
    select
      current_database() as database_name,
      to_regclass('private.user_model_settings')::text as relation_name
  `);

  console.log(`Database: ${before.rows[0].database_name}`);
  console.log(`Storage before: ${before.rows[0].relation_name ? "ready" : "missing"}`);

  if (apply && !before.rows[0].relation_name) {
    const migrationUrl = new URL(
      "../supabase/migrations/202609100001_user_model_settings.sql",
      import.meta.url,
    );
    const migration = await readFile(migrationUrl, "utf8");

    await client.query("begin");
    try {
      await client.query(migration);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  const after = await client.query(`
    select to_regclass('private.user_model_settings')::text as relation_name
  `);

  if (!after.rows[0].relation_name) {
    console.log("Storage after: missing (run again with --apply)");
    process.exitCode = 2;
  } else {
    const privileges = await client.query(`
      select
        has_table_privilege('anon', 'private.user_model_settings', 'select') as anon_can_select,
        has_table_privilege('authenticated', 'private.user_model_settings', 'select') as authenticated_can_select
    `);
    console.log("Storage after: ready");
    console.log(`Direct client access: anon=${privileges.rows[0].anon_can_select}, authenticated=${privileges.rows[0].authenticated_can_select}`);
  }
} finally {
  client.release();
  await pool.end();
}
