import assert from "node:assert/strict";
import test from "node:test";
import { claimSearchJob, refreshJobLease } from "../src/xhs-db.js";

test("job claiming never reclaims queued or stale work after max attempts", async () => {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rowCount: 0, rows: [] };
    },
  };
  const job = await claimSearchJob(pool as never, "worker-test", "creator_search");
  assert.equal(job, null);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((sql) => sql.includes("attempts < max_attempts")));
});

test("lease refresh keeps one owner alive and observes cancellation", async () => {
  const params: unknown[][] = [];
  const pool = {
    query: async (sql: string, values: unknown[]) => {
      params.push(values);
      assert.match(sql, /locked_by = \$2/);
      return { rowCount: 1, rows: [{ cancel_requested: params.length === 2 }] };
    },
  };

  assert.equal(await refreshJobLease(pool as never, "job-1", "eval-worker", 90_000), "continue");
  assert.equal(await refreshJobLease(pool as never, "job-1", "eval-worker", 90_000), "cancelled");
  assert.deepEqual(params[0], ["job-1", "eval-worker", 90]);
});

test("lease refresh stops an executor that no longer owns the job", async () => {
  const pool = { query: async () => ({ rowCount: 0, rows: [] }) };
  assert.equal(await refreshJobLease(pool as never, "job-1", "old-worker"), "lease_lost");
});
