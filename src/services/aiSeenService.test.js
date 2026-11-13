import assert from "node:assert/strict";
import test from "node:test";
import AiSeenUsage from "../models/AiSeenUsage.js";
import Publication from "../models/Publication.js";
import { AI_SEEN_MAX_DAILY, AI_SEEN_MAX_TRIES, aiSeenBaseLimit, aiSeenDateKey, grantAiSeenPublishBonus } from "./aiSeenService.js";

test("AI Seen quotas follow first-week and seller requirements", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  assert.equal(aiSeenBaseLimit({ createdAt: new Date("2026-10-29T12:00:00.000Z") }, now), 3);
  assert.equal(aiSeenBaseLimit({ createdAt: new Date("2026-01-01T00:00:00.000Z"), creatorApprovalStatus: "approved" }, now), 3);
  assert.equal(aiSeenBaseLimit({ createdAt: new Date("2026-01-01T00:00:00.000Z"), accountType: "business" }, now), 3);
  assert.equal(aiSeenBaseLimit({ createdAt: new Date("2026-01-01T00:00:00.000Z"), accountType: "personal" }, now), 1);
  assert.equal(aiSeenDateKey(now), "2026-10-30");
  assert.equal(AI_SEEN_MAX_DAILY, 3);
  assert.equal(AI_SEEN_MAX_TRIES, 3);
});

test("AI Seen usage and publication linkage have authoritative persistence", () => {
  assert.ok(AiSeenUsage.schema.indexes().some(([keys, options]) => keys.user === 1 && keys.dateKey === 1 && options.unique));
  assert.equal(AiSeenUsage.schema.path("sessions.attemptsUsed").options.max, 3);
  assert.equal(AiSeenUsage.schema.path("sessions.answerRevisionsUsed").options.max, 1);
  assert.ok(Publication.schema.path("aiAssistance.sessionId"));
  assert.ok(Publication.schema.path("aiAssistance.generated"));
});

test("publish reward feedback only confirms an actual allowance increase", async (t) => {
  let usage;
  t.mock.method(AiSeenUsage, "findOneAndUpdate", () => ({ lean: async () => usage }));
  for (const [baseLimit, publishedBonusCount, expected] of [[1, 1, true], [1, 2, true], [1, 3, false], [3, 1, false]]) {
    usage = { baseLimit, publishedBonusCount, startedCount: 1 };
    const result = await grantAiSeenPublishBonus("user", "seen");
    assert.equal(result.bonusGranted, expected);
    assert.ok(result.dailyLimit <= 3);
  }
  usage = null;
  assert.equal(await grantAiSeenPublishBonus("user", "seen"), null);
});
