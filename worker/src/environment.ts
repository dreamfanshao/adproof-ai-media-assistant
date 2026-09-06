import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { assertProductionConfig } from "../../server/src/production-config.js";
import type { WorkerEnv } from "./xhs-db.js";

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env, path = ".env.local"): WorkerEnv {
  // Production is injected by systemd. Never override it with a developer's file.
  let local: NodeJS.ProcessEnv = {};
  if (source.NODE_ENV !== "production") {
    try { local = parseEnv(readFileSync(path, "utf8").replace(/^\uFEFF/, "")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const merged = { ...source, ...local };
  assertProductionConfig(merged);
  return merged as unknown as WorkerEnv;
}
