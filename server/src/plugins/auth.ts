import { createClient } from "@supabase/supabase-js";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { ApiError } from "../errors.js";
import type { ServerConfig } from "../config.js";

export interface AuthContext {
  userId: string;
  email: string;
  accessToken: string;
}

export interface AuthVerifier {
  verify(accessToken: string): Promise<{ userId: string; email: string }>;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function createSupabaseAuthVerifier(config: ServerConfig): AuthVerifier {
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async verify(accessToken) {
      const { data, error } = await client.auth.getClaims(accessToken);
      const subject = data?.claims.sub;
      const email = data?.claims.email;
      if (!error && typeof subject === "string" && typeof email === "string") {
        return { userId: subject, email };
      }

      // Legacy/shared-secret projects may require an Auth server round-trip.
      // getUser(jwt) validates the token server-side and is safe as a fallback.
      const { data: userData, error: userError } = await client.auth.getUser(accessToken);
      const user = userData.user;
      if (userError || !user || typeof user.email !== "string") {
        const providerUnavailable = error?.status === 0 || userError?.status === 0;
        console.warn("Supabase token verification failed", {
          claimsCode: error?.code ?? "claims_unavailable",
          claimsStatus: error?.status ?? null,
          claimsMessage: error?.message ?? null,
          userCode: userError?.code ?? "user_unavailable",
          userStatus: userError?.status ?? null,
          userMessage: userError?.message ?? null,
        });
        if (providerUnavailable) {
          throw new ApiError(503, "AUTH_PROVIDER_UNAVAILABLE", "登录服务暂时不可用，请稍后重试。", true);
        }
        throw new ApiError(401, "AUTH_INVALID_TOKEN", "登录状态无效或已经过期。", false);
      }
      return { userId: user.id, email: user.email };
    },
  };
}

const authPluginBase: FastifyPluginAsync<{ verifier: AuthVerifier }> = async (app, options) => {
  app.decorateRequest("auth", null);
  app.decorate("requireAuth", async function requireAuth(request) {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
    }

    const accessToken = authorization.slice("Bearer ".length).trim();
    if (!accessToken) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
    const identity = await options.verifier.verify(accessToken);
    request.auth = { ...identity, accessToken };
  });
};

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (request: import("fastify").FastifyRequest) => Promise<void>;
  }
}

export const authPlugin = fp(authPluginBase, { name: "auth" });
