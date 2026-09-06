import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CreatorAgentRun, SkillDefinition } from "./skills/types.js";

const root = join(process.cwd(), "agent", "data");
function readJson<T>(file: string, fallback: T): T { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; } }
function writeJson(file: string, value: unknown) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }
export function loadSkills() { return readJson<SkillDefinition[]>(join(root, "skills.json"), []); }
export function saveSkills(value: SkillDefinition[]) { writeJson(join(root, "skills.json"), value); }
export function loadAgentRuns() { return readJson<CreatorAgentRun[]>(join(root, "runs.json"), []); }
export function saveAgentRuns(value: CreatorAgentRun[]) { writeJson(join(root, "runs.json"), value); }
