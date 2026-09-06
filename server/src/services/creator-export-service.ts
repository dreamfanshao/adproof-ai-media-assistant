// Phase 4｜项目达人 Excel 导出（FR-09：昵称/主页链接/粉丝/活跃度/匹配分/状态/证据摘要/获取时间）
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { ApiError } from "../errors.js";

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  selected: "已选入",
  discarded: "已弃用",
};

interface ExportRow {
  nickname: string;
  handle: string;
  followers: number | null;
  activity_score: number | null;
  match_score: number | null;
  decision_status: string;
  evidence_summary: string;
  profile_url: string;
  created_at: string | null;
  captured_at: string | null;
  updated_at: string | null;
}

function canonicalProfileUrl(profileUrl: string | null): string {
  if (!profileUrl) return "";
  try {
    const parsed = new URL(profileUrl);
    const match = parsed.pathname.match(/\/user\/profile\/([^/?#]+)/i);
    if (match?.[1]) return `https://www.xiaohongshu.com/user/profile/${match[1]}`;
  } catch {
    // keep the original value if it is not a valid URL
  }
  return profileUrl;
}

function exportIdentity(row: ExportRow): string {
  if (row.profile_url) {
    try {
      const path = new URL(row.profile_url).pathname.replace(/\/$/, "");
      if (path) return `profile:${path.toLowerCase()}`;
    } catch {
      // fall back to the handle below
    }
  }
  return `handle:${row.handle.trim().toLowerCase()}`;
}

function dedupeExportRows(rows: ExportRow[]): ExportRow[] {
  const result = new Map<string, ExportRow>();
  for (const row of rows) {
    const key = exportIdentity(row);
    const existing = result.get(key);
    if (!existing) {
      result.set(key, row);
      continue;
    }
    const preferred = (Date.parse(row.updated_at ?? "") || 0) >= (Date.parse(existing.updated_at ?? "") || 0)
      ? row
      : existing;
    const createdTimes = [existing.created_at, row.created_at]
      .filter(Boolean)
      .map((value) => Date.parse(value as string))
      .filter(Number.isFinite);
    result.set(key, {
      ...preferred,
      created_at: createdTimes.length ? new Date(Math.min(...createdTimes)).toISOString() : preferred.created_at,
    });
  }
  return [...result.values()];
}

/** 导出项目达人；项目不存在/无权访问返回 null */
export async function exportProjectCreatorsXlsx(
  client: SupabaseClient,
  projectId: string,
  userId: string,
  status?: string,
): Promise<Buffer | null> {
  const { data: project, error: projectError } = await client
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (projectError) throw new ApiError(500, "PROJECT_QUERY_FAILED", "查询项目失败。", true);
  if (!project) return null;

  let query = client
    .from("project_creators")
    .select(
      "followers,activity_score,match_score,decision_status,evidence_summary,created_at,captured_at,updated_at,creators(nickname,handle,profile_url)",
    )
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("match_score", { ascending: false, nullsFirst: false });
  if (status) query = query.eq("decision_status", status);
  const { data, error } = await query;
  if (error) throw new ApiError(500, "CREATOR_QUERY_FAILED", "查询达人失败。", true);

  const rows = dedupeExportRows((data ?? []).map((row: Record<string, unknown>) => ({
    nickname: ((row.creators as Record<string, unknown> | null)?.nickname as string) ?? "未知达人",
    handle: ((row.creators as Record<string, unknown> | null)?.handle as string | null) ?? "",
    followers: row.followers as number | null,
    activity_score: row.activity_score as number | null,
    match_score: row.match_score as number | null,
    decision_status: row.decision_status as string,
    evidence_summary: row.evidence_summary as string,
    profile_url: canonicalProfileUrl(((row.creators as Record<string, unknown> | null)?.profile_url as string | null) ?? ""),
    created_at: row.created_at as string | null,
    captured_at: row.captured_at as string | null,
    updated_at: row.updated_at as string | null,
  })));

  const sheetData = rows.map((row) => ({
    昵称: row.nickname,
    小红书号: row.handle,
    粉丝数: row.followers ?? "",
    活跃度: row.activity_score ?? "",
    匹配分: row.match_score ?? "",
    状态: STATUS_LABEL[row.decision_status] ?? row.decision_status,
    主页链接: row.profile_url,
    匹配理由: row.evidence_summary,
    首次检索时间: row.created_at ? new Date(row.created_at).toLocaleString("zh-CN") : "",
    最近更新数据: row.captured_at ? new Date(row.captured_at).toLocaleString("zh-CN") : "",
    更新时间: row.updated_at ? new Date(row.updated_at).toLocaleString("zh-CN") : "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetData);
  worksheet["!cols"] = [
    { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 8 },
    { wch: 10 }, { wch: 46 }, { wch: 50 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "达人列表");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
