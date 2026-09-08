import type pg from "pg";
import { ApiError } from "../errors.js";

export async function isAdmin(pool: pg.Pool | null, userId: string): Promise<boolean> {
  if (!pool) return false;
  try {
    const result = await pool.query(
      "select 1 from private.admin_users where user_id = $1 and role in ('admin', 'super_admin') limit 1",
      [userId],
    );
    return result.rowCount === 1;
  } catch (error) {
    // A missing migration must fail closed. It must never turn into admin access.
    if (String(error).includes("admin_users")) return false;
    throw error;
  }
}

export async function requireAdmin(pool: pg.Pool | null, userId: string): Promise<void> {
  if (!(await isAdmin(pool, userId))) {
    throw new ApiError(403, "ADMIN_REQUIRED", "仅管理员可以访问运营中心。", false);
  }
}
