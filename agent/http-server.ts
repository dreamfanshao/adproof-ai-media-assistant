import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCreatorPlan } from "./planner.js";
import { runCreatorAgent } from "./executor.js";
import { listSkills, updateSkill, getSkill } from "./skills/registry.js";
import { listTools } from "./tools/registry.js";
import { loadAgentRuns } from "./storage.js";

const port = Number(process.env.AGENT_PORT || 3092);
const pages = { "/": "agent.html", "/agent": "agent.html", "/skills": "skills.html" };
const json = (response: import("node:http").ServerResponse, status: number, value: unknown) => { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify(value)); };
async function body(request: import("node:http").IncomingMessage) { let raw = ""; for await (const chunk of request) raw += chunk; try { return JSON.parse(raw || "{}"); } catch { return {}; } }
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  try {
    if (request.method === "GET" && url.pathname === "/api/agent/skills") return json(response, 200, listSkills());
    if (request.method === "GET" && url.pathname === "/api/agent/tools") return json(response, 200, listTools());
    if (request.method === "GET" && url.pathname === "/api/agent/runs") return json(response, 200, loadAgentRuns());
    if (request.method === "POST" && url.pathname === "/api/agent/plan") { const input = await body(request) as { query?: string; candidates?: Array<{ imageUrls?: string[] }> }; return json(response, 200, await createCreatorPlan(input.query || "", input.candidates || [])); }
    if (request.method === "POST" && url.pathname === "/api/agent/runs") { const input = await body(request) as { query?: string; candidates?: any[] }; return json(response, 200, await runCreatorAgent({ query: input.query || "", candidates: input.candidates || [] })); }
    const skillMatch = url.pathname.match(/^\/api\/agent\/skills\/([^/]+)$/);
    if (skillMatch && request.method === "PATCH") { const patch = await body(request); return json(response, 200, updateSkill(decodeURIComponent(skillMatch[1]), patch)); }
    const testMatch = url.pathname.match(/^\/api\/agent\/skills\/([^/]+)\/test$/);
    if (testMatch && request.method === "POST") { const input = await body(request) as { prompt?: string; images?: Array<{ url: string }> }; const skill = getSkill(decodeURIComponent(testMatch[1])); if (!skill) return json(response, 404, { error: "skill_not_found" }); const { callJsonModel } = await import("./llm/openai-compatible.js"); return json(response, 200, await callJsonModel({ system: skill.prompt, prompt: input.prompt || "", images: input.images, model: skill.model, temperature: skill.temperature })); }
    if (request.method === "GET" && pages[url.pathname as keyof typeof pages]) { const file = join(process.cwd(), "agent", "public", pages[url.pathname as keyof typeof pages]); response.setHeader("Content-Type", "text/html; charset=utf-8"); return response.end(readFileSync(file)); }
    return json(response, 404, { error: "not_found" });
  } catch (error) { return json(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, "127.0.0.1", () => console.log("Skill Agent listening on http://127.0.0.1:" + port));
