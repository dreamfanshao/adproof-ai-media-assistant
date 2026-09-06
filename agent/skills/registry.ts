import { getSkill as getCatalogSkill, getSkills, patchSkill } from "../catalog.js";
import type { SkillDefinition } from "./types.js";

export function listSkills(): SkillDefinition[] { return getSkills(); }
export function getSkill(id: string): SkillDefinition | undefined { return getCatalogSkill(id); }
export function updateSkill(id: string, patch: Partial<SkillDefinition>): SkillDefinition | undefined { return patchSkill(id, patch); }
