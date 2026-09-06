import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

function readLocalValue(key: string): string {
  try {
    const source = readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "");
    const line = source.split(/\r?\n/).find((item) => item.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : "";
  } catch {
    return "";
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL || readLocalValue("VITE_SUPABASE_URL");
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || readLocalValue("VITE_SUPABASE_PUBLISHABLE_KEY");
  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publishableKey),
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:3001",
      },
      watch: {
        ignored: ["**/worker/**", "**/.tmpdir/**", "**/*.tmp"],
      },
    },
  };
});
