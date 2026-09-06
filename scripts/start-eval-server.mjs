import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const output = resolve(root, ".runtime", "eval-server.mjs");
const esbuild = resolve(root, "node_modules", "esbuild", "bin", "esbuild");
const sourceUrl = pathToFileURL(resolve(root, "eval", "server.ts")).href;

mkdirSync(dirname(output), { recursive: true });
const build = spawnSync(process.execPath, [
  esbuild,
  "eval/server.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--packages=external",
  `--define:import.meta.url=${JSON.stringify(sourceUrl)}`,
  `--outfile=${output}`,
], { cwd: root, stdio: "inherit" });

if (build.status !== 0) process.exit(build.status ?? 1);

const child = spawn(process.execPath, ["--env-file=.env.local", output], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

const forwardSignal = (signal) => child.kill(signal);
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
