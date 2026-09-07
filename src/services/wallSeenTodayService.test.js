import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import {
  acknowledgeWallSawYouToday,
  getWallSawYouToday,
  productDayRange,
  sawYouTodayPipeline,
  serializeSawYouTodayRow,
} from "./wallSeenTodayService.js";

function chain(value) {
  return {
    select() {
      return {
        lean: async () => value,
      };
    },
  };
}

test("productDayRange uses the local calendar day", () => {
  const now = new Date("2026-08-31T14:30:00.000Z");
  const { end, start } = productDayRange(now);

  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
  assert.equal(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
});

test("sawYouTodayPipeline filters current user, blocked users, future, and non-active records", () => {
  const userId = new mongoose.Types.ObjectId();
  const blockedId = new mongoose.Types.ObjectId();
  const now = new Date("2026-08-31T10:00:00.000Z");
  const pipeline = sawYouTodayPipeline({ blockedIds: [blockedId], limit: 3, now, userId });
  const match = pipeline[0].$match;

  assert.equal(String(match.targetUser), String(userId));
  assert.equal(match.type, "SEE_YOU");
  assert.equal(match.status, "active");
  assert.deepEqual(match.sender.$nin.map(String), [String(userId), String(blockedId)]);
  const timeMatch = pipeline.find((stage) => stage.$match?.wallOccurredAt)?.$match;
  assert.equal(timeMatch.wallOccurredAt.$gte.getHours(), 0);
  assert.equal(timeMatch.wallOccurredAt.$lt.getTime() - timeMatch.wallOccurredAt.$gte.getTime(), 24 * 60 * 60 * 1000);
  assert.equal(timeMatch.wallOccurredAt.$lte, now);
  assert.equal(timeMatch.$expr, undefined);
  assert.deepEqual(pipeline.at(-1).$facet.people, [{ $limit: 3 }]);
});

test("sawYouTodayPipeline counts unique people by latest event", () => {
  const pipeline = sawYouTodayPipeline({ now: new Date("2026-08-31T10:00:00.000Z"), userId: new mongoose.Types.ObjectId() });

  assert.deepEqual(pipeline.find((stage) => stage.$group).$group, {
    _id: "$sender",
    eventId: { $first: "$_id" },
    occurredAt: { $first: "$wallOccurredAt" },
    acknowledgedAt: { $first: "$acknowledgedAt" },
  });
  assert.deepEqual(pipeline.find((stage) => stage.$facet).$facet.total, [{ $count: "count" }]);
  assert.deepEqual(pipeline.find((stage) => stage.$facet).$facet.unseen, [{ $match: { unseen: true } }, { $count: "count" }]);
});

test("serializeSawYouTodayRow exposes only public-safe profile fields", () => {
  const eventId = new mongoose.Types.ObjectId();
  const senderId = new mongoose.Types.ObjectId();
  const occurredAt = new Date("2026-08-31T09:30:00.000Z");
  const serialized = serializeSawYouTodayRow({
    eventId,
    occurredAt,
    senderUser: {
      _id: senderId,
      name: "Lina Moreau",
      username: "lina",
      avatar: "https://cdn.example/lina.jpg",
      email: "private@example.com",
      password: "secret",
      isVerified: true,
      role: "creator",
    },
  });
  const json = JSON.stringify(serialized);

  assert.equal(serialized.eventId, String(eventId));
  assert.equal(serialized.user.id, String(senderId));
  assert.equal(serialized.user.displayName, "Lina Moreau");
  assert.equal(serialized.user.avatarUrl, "https://cdn.example/lina.jpg");
  assert.equal(serialized.occurredAt, occurredAt.toISOString());
  assert.equal(json.includes("private@example.com"), false);
  assert.equal(json.includes("secret"), false);
});

test("getWallSawYouToday returns zero state without fake rows", async () => {
  const user = { _id: new mongoose.Types.ObjectId() };
  const data = await getWallSawYouToday(user, {
    models: {
      UserBlock: { find: () => chain([]) },
      OrbitSignal: { aggregate: async () => [{ people: [], total: [] }] },
    },
  });

  assert.deepEqual(data, { count: 0, hasUnseen: false, people: [], unseenCount: 0 });
});

test("getWallSawYouToday returns newest public people and unseen state from the database result", async () => {
  const user = { _id: new mongoose.Types.ObjectId() };
  const eventId = new mongoose.Types.ObjectId();
  const senderId = new mongoose.Types.ObjectId();
  const data = await getWallSawYouToday(user, {
    models: {
      UserBlock: { find: () => chain([]) },
      OrbitSignal: {
        aggregate: async () => [{
          people: [{
            eventId,
            occurredAt: new Date("2026-08-31T09:30:00.000Z"),
            senderUser: { _id: senderId, name: "Omar Haddad", username: "omar", avatar: "", isVerified: false, role: "fan" },
          }],
          total: [{ count: 1 }],
          unseen: [{ count: 1 }],
        }],
      },
    },
  });

  assert.equal(data.count, 1);
  assert.equal(data.hasUnseen, true);
  assert.equal(data.unseenCount, 1);
  assert.equal(data.people[0].user.username, "omar");
});

test("getWallSawYouToday keeps acknowledged viewers in today's count", async () => {
  const user = { _id: new mongoose.Types.ObjectId() };
  const data = await getWallSawYouToday(user, {
    models: {
      UserBlock: { find: () => chain([]) },
      OrbitSignal: {
        aggregate: async () => [{
          people: [],
          total: [{ count: 4 }],
          unseen: [],
        }],
      },
    },
  });

  assert.equal(data.count, 4);
  assert.equal(data.hasUnseen, false);
  assert.equal(data.unseenCount, 0);
});

test("acknowledgeWallSawYouToday is idempotent for empty or invalid event lists", async () => {
  const user = { _id: new mongoose.Types.ObjectId() };

  assert.deepEqual(await acknowledgeWallSawYouToday(user, []), { acknowledged: 0, matched: 0 });
  assert.deepEqual(await acknowledgeWallSawYouToday(user, ["not-an-id"]), { acknowledged: 0, matched: 0 });
  await assert.rejects(() => acknowledgeWallSawYouToday(user, "not-array"), /eventIds must be an array/);
});

test("acknowledgeWallSawYouToday updates only exact active unacknowledged target events", async () => {
  const user = { _id: new mongoose.Types.ObjectId() };
  const eventId = new mongoose.Types.ObjectId();
  let capturedFilter = null;
  let capturedUpdate = null;

  const occurredAt = new Date("2026-08-31T09:59:00.000Z");
  const result = await acknowledgeWallSawYouToday(user, [], {
    acknowledgedAt: new Date("2026-08-31T10:00:00.000Z"),
    events: [{ eventId: String(eventId), occurredAt: occurredAt.toISOString() }],
    models: {
      OrbitSignal: {
        updateMany: async (filter, update) => {
          capturedFilter = filter;
          capturedUpdate = update;
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    },
  });

  assert.equal(result.acknowledged, 1);
  assert.equal(String(capturedFilter.targetUser), String(user._id));
  assert.equal(String(capturedFilter.$or[0]._id), String(eventId));
  assert.deepEqual(capturedFilter.$or[0].$or[0], { signaledAt: { $lte: occurredAt } });
  assert.equal(capturedFilter.type, "SEE_YOU");
  assert.equal(capturedFilter.status, "active");
  assert.deepEqual(capturedFilter.$expr.$or[0], { $eq: ["$acknowledgedAt", null] });
  assert.ok(capturedUpdate.$set.acknowledgedAt instanceof Date);
});
