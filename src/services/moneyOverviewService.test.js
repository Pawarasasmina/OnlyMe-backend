import test from "node:test";
import assert from "node:assert/strict";
import { moneyOverviewCsv, moneyOverviewRange } from "./moneyOverviewService.js";

test("money overview accepts day and month reporting ranges", () => {
  const daily = moneyOverviewRange({ from: "2026-11-01", to: "2026-11-25", interval: "day" });
  assert.equal(daily.interval, "day");
  assert.equal(daily.start.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(daily.end.toISOString(), "2026-11-25T23:59:59.999Z");
  assert.equal(moneyOverviewRange({ from: "2026-01-01", to: "2026-11-25", interval: "month" }).interval, "month");
});

test("money overview rejects reversed and oversized ranges", () => {
  assert.throws(() => moneyOverviewRange({ from: "2026-11-25", to: "2026-11-01" }), /valid financial reporting range/);
  assert.throws(() => moneyOverviewRange({ from: "2024-01-01", to: "2026-01-01" }), /up to 366 days/);
});

test("money overview CSV includes accounting columns and zero values", () => {
  const csv = moneyOverviewCsv({ rows: [{ period: "2026-11", webCoinsSold: 10, mobileCoinsSold: 0, grossUsd: 1.49 }] });
  assert.match(csv, /period,webCoinsSold,mobileCoinsSold/);
  assert.match(csv, /"2026-11","10","0","1.49"/);
});
