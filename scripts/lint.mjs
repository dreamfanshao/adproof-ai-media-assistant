import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
const roots = ["src", "server", "worker", "agent", "eval"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".css"]);
const problems = [];
function walk(dir) { if (!existsSync(dir)) return; for (const entry of readdirSync(dir,{withFileTypes:true})) { const path=join(dir,entry.name); if(entry.isDirectory()) walk(path); else if(extensions.has(path.slice(path.lastIndexOf(".")))) { const text=readFileSync(path,"utf8"); if(text.includes("<<<<<<<")||text.includes(">>>>>>>")||text.includes("\u0000")) problems.push(relative(process.cwd(),path)); } } }
roots.forEach(walk);
if(problems.length){ console.error("Lint failed: merge markers or null bytes in", problems.join(", ")); process.exit(1); }
console.log("Lint passed: no merge markers or null bytes.");
