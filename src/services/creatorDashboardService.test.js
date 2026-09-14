import assert from "node:assert/strict";
import test from "node:test";
import { percentageRows } from "./creatorDashboardService.js";

test("percentageRows allocates rounded percentages that total 100", () => {
  const rows = percentageRows([
    { label: "Discover", value: 2 },
    { label: "Wall", value: 1 },
    { label: "Seen", value: 1 },
  ]);

  assert.deepEqual(rows.map((row) => row.percent), [50, 25, 25]);
  assert.equal(rows.reduce((sum, row) => sum + row.percent, 0), 100);
});

test("percentageRows preserves empty source rows without fabricated percentages", () => {
  const rows = percentageRows([
    { label: "Discover", value: 0 },
    { label: "Wall", value: 0 },
  ]);

  assert.deepEqual(rows.map((row) => row.percent), [0, 0]);
});
