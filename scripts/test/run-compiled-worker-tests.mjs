import { build } from "esbuild";
import { readdirSync, mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
mkdirSync(".runtime", { recursive: true });
const directory = mkdtempSync(resolve(".runtime", "worker-tests-"));
const files = readdirSync("worker/test").filter((name) => name.endsWith(".test.ts"));
const outputs = [];
for (const name of files) {
  const outfile = join(directory, name.replace(/\.ts$/, ".mjs"));
  await build({ entryPoints: [join("worker/test", name)], outfile, bundle: true, platform: "node", format: "esm", packages: "external" });
  outputs.push(outfile);
}
const result = spawnSync(process.execPath, ["--test", ...outputs], { stdio: "inherit", env: process.env });
process.exitCode = result.status ?? 1;
