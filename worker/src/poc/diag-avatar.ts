// 临时诊断：avatar_url 覆盖率（验证后删除）
import { readFileSync } from "node:fs";
import { Client } from "pg";

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim();
}

const c = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const total = await c.query("select count(*)::int as n from public.creators where avatar_url is not null");
  const all = await c.query("select count(*)::int as n from public.creators");
  console.log(`creators with avatar: ${total.rows[0].n} / ${all.rows[0].n}`);
  const samples = await c.query("select nickname, avatar_url from public.creators limit 6");
  console.log("SAMPLES:", JSON.stringify(samples.rows, null, 2));
  const distinct = await c.query("select split_part(avatar_url, '/', 3) as host, count(*)::int as n from public.creators where avatar_url is not null group by host");
  console.log("HOSTS:", JSON.stringify(distinct.rows));
} finally {
  await c.end();
}
