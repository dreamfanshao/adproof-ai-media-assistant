import { buildApp } from "./app.js";
import { loadServerConfig } from "./config.js";

try {
  const config = loadServerConfig();
  const app = await buildApp({ config, logger: true });
  const shutdown = () => { void app.close().catch(() => { process.exitCode = 1; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  console.error(error instanceof Error ? error.message : "API startup failed.");
  process.exitCode = 1;
}
