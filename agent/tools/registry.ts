import { tools } from "../catalog.js";
import type { ToolDefinition } from "../skills/types.js";
export function listTools(): ToolDefinition[] { return tools; }
export function getTool(id: string): ToolDefinition | undefined { return tools.find((tool) => tool.id === id); }
