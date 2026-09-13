import assert from "node:assert/strict";
import test from "node:test";
import { SEARCH_TARGET_COUNTS, targetCountSchema } from "../src/routes/search.js";

test("creator search accepts only the selectable target counts", () => {
  assert.deepEqual(SEARCH_TARGET_COUNTS, [20, 30, 40, 50]);
  for (const count of SEARCH_TARGET_COUNTS) assert.equal(targetCountSchema.safeParse(count).success, true);
  for (const count of [0, 10, 25, 60]) assert.equal(targetCountSchema.safeParse(count).success, false);
});
