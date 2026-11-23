import test from "node:test";
import assert from "node:assert/strict";
import AnalyticsEvent from "../models/AnalyticsEvent.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import { getProductPeakUsage, getProductAnalytics, summarizeProductEvents, productEventMatch, supportMatch } from "./productAnalyticsService.js";

test("daily events never leak counts between days and support uses debit amounts", () => {
  const report = summarizeProductEvents([
    { _id: { day: "2026-11-23", eventType: "WORLD_OPEN" }, count: 4 },
    { _id: { day: "2026-11-24", eventType: "SAVE" }, count: 2 },
    { _id: { day: "2026-11-24", eventType: "FAST_SKIP" }, count: 1 },
  ], [{ _id: "2026-11-25", count: 3, coins: 100 }]);
  assert.deepEqual(report.totals, { world_open: 4, chapter_complete: 0, scroll_skip: 1, support: 3, save: 2 });
  assert.equal(report.trend[1].world_open, 0);
  assert.equal(report.trend[2].save, 0);
  assert.equal(report.supportCoins, 100);
  assert.equal(report.timezone, "Asia/Dubai");
});
test("queries exclude TEST and support counts gifts, never top-ups or payout movements", () => {
  const start=new Date(), end=new Date();
  assert.deepEqual(productEventMatch(start,end).actorAccountType, { $ne: "TEST" });
  const support=supportMatch(start,end);
  assert.equal(support.direction,"DEBIT");
  assert.deepEqual(support.entryType.$in,["DREAM_GIFT_DEBIT","CHAT_GIFT_DEBIT"]);
  assert.deepEqual(support.financialMode,{ $ne:"TEST" });
  assert.equal(productEventMatch(start,end,"TEST").actorAccountType,"TEST");
  assert.equal(supportMatch(start,end,"TEST").financialMode,"TEST");
});
test("report and peak pipelines use Dubai grouping and count each source once", async t => {
  const pipelines=[];
  t.mock.method(AnalyticsEvent,"aggregate", pipeline=>{pipelines.push(pipeline);return Promise.resolve([{_id:{hour:0,day:2},count:2}]);});
  t.mock.method(StarsLedgerEntry,"aggregate", pipeline=>{pipelines.push(pipeline);return Promise.resolve([{_id:{hour:0,day:2},count:1}]);});
  const peak=await getProductPeakUsage(new Date("2026-11-22T20:00:00Z"),new Date("2026-11-23T19:59:59Z"));
  assert.equal(peak.hours.length,24);
  assert.equal(peak.hours[0].count,3);
  assert.equal(peak.days[1].count,3);
  for(const pipeline of pipelines) assert.equal(pipeline[1].$group._id.hour.$hour.timezone,"Asia/Dubai");
  pipelines.length=0;
  t.mock.method(AnalyticsEvent,"aggregate",pipeline=>{pipelines.push(pipeline);return Promise.resolve([]);});
  t.mock.method(StarsLedgerEntry,"aggregate",pipeline=>{pipelines.push(pipeline);return Promise.resolve([]);});
  const report=await getProductAnalytics(new Date(),new Date());
  assert.equal(report.totals.support,0);
  assert.equal(pipelines[0][1].$group._id.day.$dateToString.timezone,"Asia/Dubai");
});
