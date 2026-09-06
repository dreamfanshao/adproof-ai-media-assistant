import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/lib/database.types.js";
import type { ServerConfig } from "../config.js";
import { ApiError } from "../errors.js";

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileRepository {
  get(accessToken: string, userId: string, email: string): Promise<UserProfile>;
  update(accessToken: string, userId: string, email: string, displayName: string): Promise<UserProfile>;
}

export function createProfileRepository(config: ServerConfig): ProfileRepository {
  const userClient = (accessToken: string) => createClient<Database>(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      accessToken: async () => accessToken,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );

  const toProfile = (row: Database["public"]["Tables"]["user_profiles"]["Row"], email: string): UserProfile => ({
    id: row.user_id,
    email,
    display_name: row.display_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });

  return {
    async get(accessToken, userId, email) {
      const { data, error } = await userClient(accessToken)
        .from("user_profiles")
        .select("user_id,display_name,created_at,updated_at")
        .eq("user_id", userId)
        .single();
      if (error || !data) {
        throw new ApiError(503, "PROFILE_UNAVAILABLE", "暂时无法读取用户资料。", true);
      }
      return toProfile(data, email);
    },
    async update(accessToken, userId, email, displayName) {
      const { data, error } = await userClient(accessToken)
        .from("user_profiles")
        .update({ display_name: displayName })
        .eq("user_id", userId)
        .select("user_id,display_name,created_at,updated_at")
        .single();
      if (error || !data) {
        throw new ApiError(503, "PROFILE_UPDATE_FAILED", "暂时无法更新用户资料。", true);
      }
      return toProfile(data, email);
    },
  };
}
