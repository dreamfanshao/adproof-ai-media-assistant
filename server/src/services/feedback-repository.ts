import { createClient } from "@supabase/supabase-js";
import type { ServerConfig } from "../config.js";
import { ApiError } from "../errors.js";

export type FeedbackCategory = "bug" | "suggestion" | "question" | "other";
export type FeedbackStatus = "open" | "in_progress" | "resolved" | "closed";

export interface FeedbackTicket {
  id: string;
  user_id: string;
  category: FeedbackCategory;
  title: string;
  description: string;
  page_path: string | null;
  status: FeedbackStatus;
  priority: "low" | "normal" | "high" | "urgent";
  admin_reply: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface CreateFeedbackInput {
  category: FeedbackCategory;
  title: string;
  description: string;
  page_path?: string | null;
}

export interface FeedbackRepository {
  list(userId: string, accessToken?: string): Promise<FeedbackTicket[]>;
  create(userId: string, input: CreateFeedbackInput, accessToken?: string): Promise<FeedbackTicket>;
}

export function createFeedbackRepository(config: ServerConfig): FeedbackRepository {
  const serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey ?? config.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const clientFor = (accessToken?: string) => config.supabaseServiceRoleKey || !accessToken
    ? serviceClient
    : createClient(config.supabaseUrl, config.supabasePublishableKey, {
      accessToken: async () => accessToken,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

  return {
    async list(userId, accessToken) {
      const { data, error } = await clientFor(accessToken)
        .from("feedback_tickets")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw feedbackRepositoryError("FEEDBACK_QUERY_FAILED", error);
      return (data ?? []) as FeedbackTicket[];
    },
    async create(userId, input, accessToken) {
      const { data, error } = await clientFor(accessToken)
        .from("feedback_tickets")
        .insert({ user_id: userId, ...input, page_path: input.page_path ?? null })
        .select("*")
        .single();
      if (error || !data) throw feedbackRepositoryError("FEEDBACK_CREATE_FAILED", error);
      return data as FeedbackTicket;
    },
  };
}

function feedbackRepositoryError(code: "FEEDBACK_QUERY_FAILED" | "FEEDBACK_CREATE_FAILED", error: { code?: string } | null) {
  if (error) console.error("Feedback repository error", { operation: code, providerCode: error.code, providerMessage: (error as { message?: string }).message });
  if (error?.code === "PGRST205" || error?.code === "42P01") {
    return new ApiError(503, code, "反馈功能尚未完成数据库初始化，请管理员先应用 supabase/migrations/202609040001_feedback_tickets.sql。", true);
  }
  return new ApiError(503, code, code === "FEEDBACK_CREATE_FAILED" ? "反馈提交失败，请稍后重试。" : "暂时无法加载反馈工单，请稍后重试。", true);
}
