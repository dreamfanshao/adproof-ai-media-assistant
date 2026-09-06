import { z } from "zod";

import { assertProductionConfig } from "./production-config.js";

const configSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGINS: z.string().default("http://127.0.0.1:5173,http://localhost:5173"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  XHS_SESSION_ENCRYPTION_KEY: z.string().min(1).optional(),
  XHS_DATA_PROVIDER: z.literal("redfox").optional(),
  REDFOX_API_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
}).superRefine((value, context) => {
  const persistenceValues = [value.SUPABASE_SERVICE_ROLE_KEY, value.XHS_SESSION_ENCRYPTION_KEY];
  if (persistenceValues.some(Boolean) && !persistenceValues.every(Boolean)) {
    context.addIssue({
      code: "custom",
      path: ["XHS_SESSION_ENCRYPTION_KEY"],
      message: "SUPABASE_SERVICE_ROLE_KEY and XHS_SESSION_ENCRYPTION_KEY must be configured together",
    });
  }
});

export interface ServerConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  host: string;
  port: number;
  webOrigins: string[];
  supabaseServiceRoleKey?: string;
  xhsSessionEncryptionKey?: string;
  xhsDataProvider?: "redfox";
  databaseUrl?: string;
  redfoxApiKey?: string;
  openaiApiKey?: string;
  openaiModel?: string;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  assertProductionConfig(env);
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Server environment is invalid or incomplete: ${fields}`);
  }

  return {
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabasePublishableKey: parsed.data.SUPABASE_PUBLISHABLE_KEY,
    host: parsed.data.API_HOST,
    port: parsed.data.API_PORT,
    webOrigins: parsed.data.WEB_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    xhsSessionEncryptionKey: parsed.data.XHS_SESSION_ENCRYPTION_KEY,
    xhsDataProvider: parsed.data.XHS_DATA_PROVIDER ?? "redfox",
    databaseUrl: parsed.data.DATABASE_URL,
    redfoxApiKey: parsed.data.REDFOX_API_KEY,
    openaiApiKey: parsed.data.OPENAI_API_KEY,
    openaiModel: parsed.data.OPENAI_MODEL,
  };
}


