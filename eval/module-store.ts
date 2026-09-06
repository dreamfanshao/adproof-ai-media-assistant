import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleEvalBatch, ModuleEvalCase, ModuleEvalRun, ProductModule } from "./module-types.js";

const DATA_DIR = resolve(process.env.ADPROOF_EVAL_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "data"));
const lockedFiles = new Set<string>();

function safePath(fileName: string): string {
  if (!/^[a-z0-9_-]+\.json$/i.test(fileName)) throw new Error("非法数据文件名");
  const path = resolve(DATA_DIR, fileName);
  if (!path.startsWith(`${DATA_DIR}\\`) && path !== DATA_DIR) throw new Error("拒绝路径穿越");
  return path;
}

function readJson<T>(fileName: string, fallback: T): T {
  const path = safePath(fileName);
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}

function writeJson<T>(fileName: string, value: T): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const path = safePath(fileName);
  if (lockedFiles.has(path)) throw new Error(`数据文件正在写入：${fileName}`);
  lockedFiles.add(path);
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    throw error;
  } finally {
    lockedFiles.delete(path);
  }
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

const fileFor = (kind: "cases" | "batches" | "runs") => `module_eval_${kind}.json`;

export function loadModuleCases(module?: ProductModule): ModuleEvalCase[] {
  const rows = readJson<ModuleEvalCase[]>(fileFor("cases"), []);
  return module ? rows.filter((item) => item.module === module) : rows;
}

export function saveModuleCases(rows: ModuleEvalCase[]): void { writeJson(fileFor("cases"), rows); }

export function upsertModuleCase(item: ModuleEvalCase): ModuleEvalCase {
  const rows = loadModuleCases();
  const index = rows.findIndex((row) => row.id === item.id);
  if (index >= 0) rows[index] = item; else rows.push(item);
  saveModuleCases(rows);
  return item;
}

export function deleteModuleCase(id: string, module: ProductModule): boolean {
  const rows = loadModuleCases();
  const next = rows.filter((item) => !(item.id === id && item.module === module));
  if (next.length === rows.length) return false;
  saveModuleCases(next);
  return true;
}

export function loadModuleBatches(module?: ProductModule): ModuleEvalBatch[] {
  const rows = readJson<ModuleEvalBatch[]>(fileFor("batches"), []);
  const filtered = module ? rows.filter((item) => item.module === module) : rows;
  return filtered.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function saveModuleBatches(rows: ModuleEvalBatch[]): void { writeJson(fileFor("batches"), rows); }

export function putModuleBatch(batch: ModuleEvalBatch): ModuleEvalBatch {
  const rows = loadModuleBatches();
  const index = rows.findIndex((item) => item.id === batch.id);
  if (index >= 0) rows[index] = batch; else rows.unshift(batch);
  saveModuleBatches(rows);
  return batch;
}

export function getModuleBatch(id: string, module: ProductModule): ModuleEvalBatch | undefined {
  return loadModuleBatches(module).find((item) => item.id === id);
}

export function loadModuleRuns(module?: ProductModule): ModuleEvalRun[] {
  const rows = readJson<ModuleEvalRun[]>(fileFor("runs"), []);
  const filtered = module ? rows.filter((item) => item.module === module) : rows;
  return filtered.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function saveModuleRuns(rows: ModuleEvalRun[]): void { writeJson(fileFor("runs"), rows); }

export function putModuleRun(run: ModuleEvalRun): ModuleEvalRun {
  const rows = loadModuleRuns();
  const next = [run, ...rows.filter((item) => item.id !== run.id)].slice(0, 1000);
  saveModuleRuns(next);
  return run;
}

export function moduleRunById(id: string, module: ProductModule): ModuleEvalRun | undefined {
  return loadModuleRuns(module).find((item) => item.id === id);
}
