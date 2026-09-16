import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { getOperationsOverview } from "../src/services/operations-analytics.js";

function fakePool(creatorRow: { retrieved_creators: number; selected_creators: number }): pg.Pool {
  return {
    async query(sql: string) {
      if (sql.includes("from public.user_profiles")) {
        return { rows: [{ registered_users: 3, new_users_today: 0, new_users_7d: 1 }] };
      }
      if (sql.includes("from private.analytics_events")) return { rows: [] };
      if (sql.includes("from public.feedback_tickets")) {
        return { rows: [{ total: 0, open: 0, in_progress: 0, resolved: 0, bugs: 0 }] };
      }
      if (sql.includes("from public.project_creators")) {
        assert.match(sql, /search_task_id is not null/);
        assert.match(sql, /decision_status = 'selected'/);
        return { rows: [creatorRow] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;
}

test("operations overview reports selected creators divided by retrieved creators", async () => {
  const overview = await getOperationsOverview(fakePool({ retrieved_creators: 397, selected_creators: 5 }));
  assert.equal(overview.retrievedCreators, 397);
  assert.equal(overview.selectedCreators, 5);
  assert.equal(overview.creatorSelectionRate, 1.3);
});

test("operations overview has no north-star rate before creators are retrieved", async () => {
  const overview = await getOperationsOverview(fakePool({ retrieved_creators: 0, selected_creators: 0 }));
  assert.equal(overview.creatorSelectionRate, null);
});
