import mongoose from "mongoose";
import OrbitSignal from "../models/OrbitSignal.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import ApiError from "../utils/ApiError.js";

const MAX_PEOPLE = 100;

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(value);
}

function validObjectIds(values = []) {
  return [...new Set(values.map(String))]
    .filter((value) => mongoose.isValidObjectId(value))
    .map((value) => new mongoose.Types.ObjectId(value));
}

function validAcknowledgementEvents(events = []) {
  return events.flatMap((event) => {
    if (!mongoose.isValidObjectId(event?.eventId)) return [];
    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return [];
    return [{ eventId: new mongoose.Types.ObjectId(event.eventId), occurredAt }];
  });
}

export function productDayRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { end, start };
}

export async function blockedUserIdsFor(userId, models = { UserBlock }) {
  const blocks = await models.UserBlock.find({
    $or: [{ blocker: userId }, { blocked: userId }],
  }).select("blocker blocked").lean();

  return blocks.map((block) => String(block.blocker) === String(userId) ? block.blocked : block.blocker);
}

export function serializeSawYouTodayRow(row) {
  const user = row.senderUser || {};
  return {
    eventId: String(row.eventId),
    user: {
      id: String(user._id),
      username: user.username || "",
      displayName: user.name || user.username || "Profile",
      avatarUrl: user.avatar || "",
      verified: Boolean(user.isVerified),
      role: user.role,
    },
    occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : row.occurredAt,
  };
}

export function sawYouTodayPipeline({ blockedIds = [], limit = MAX_PEOPLE, now = new Date(), userId }) {
  const { end, start } = productDayRange(now);
  const excludedSenders = validObjectIds([userId, ...blockedIds]);

  return [
    {
      $match: {
        targetUser: toObjectId(userId),
        type: "SEE_YOU",
        status: "active",
        ...(excludedSenders.length ? { sender: { $nin: excludedSenders } } : {}),
      },
    },
    {
      $addFields: {
        wallOccurredAt: { $ifNull: ["$signaledAt", "$createdAt"] },
      },
    },
    {
      $match: {
        wallOccurredAt: { $gte: start, $lt: end, $lte: now },
      },
    },
    { $sort: { wallOccurredAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$sender",
        eventId: { $first: "$_id" },
        occurredAt: { $first: "$wallOccurredAt" },
        acknowledgedAt: { $first: "$acknowledgedAt" },
      },
    },
    {
      $addFields: {
        unseen: {
          $or: [
            { $eq: ["$acknowledgedAt", null] },
            { $lt: ["$acknowledgedAt", "$occurredAt"] },
          ],
        },
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "senderUser",
      },
    },
    { $unwind: "$senderUser" },
    {
      $match: {
        "senderUser.role": { $in: ["fan", "creator"] },
        "senderUser.status": "active",
      },
    },
    { $sort: { occurredAt: -1, eventId: -1 } },
    {
      $facet: {
        people: [{ $limit: Math.min(MAX_PEOPLE, Math.max(1, Number(limit) || MAX_PEOPLE)) }],
        total: [{ $count: "count" }],
        unseen: [{ $match: { unseen: true } }, { $count: "count" }],
      },
    },
  ];
}

export async function getWallSawYouToday(user, options = {}) {
  const models = options.models || { OrbitSignal, UserBlock };
  const limit = Math.min(MAX_PEOPLE, Math.max(1, Number(options.limit) || MAX_PEOPLE));
  const blockedIds = await blockedUserIdsFor(user._id, models);
  const [result = {}] = await models.OrbitSignal.aggregate(sawYouTodayPipeline({
    blockedIds,
    limit,
    now: options.now || new Date(),
    userId: user._id,
  }));
  const people = (result.people || []).map(serializeSawYouTodayRow);
  const count = Number(result.total?.[0]?.count || people.length || 0);
  const unseenCount = Number(result.unseen?.[0]?.count || 0);

  return {
    count,
    hasUnseen: unseenCount > 0,
    people,
    unseenCount,
  };
}

export async function acknowledgeWallSawYouToday(user, eventIds = [], options = {}) {
  const eventInput = options.events || eventIds;
  if (!Array.isArray(eventInput)) {
    throw new ApiError(400, "eventIds must be an array");
  }

  const events = eventInput[0]?.eventId
    ? validAcknowledgementEvents(eventInput)
    : validObjectIds(eventInput).map((eventId) => ({ eventId, occurredAt: null }));

  if (!events.length) {
    return { acknowledged: 0, matched: 0 };
  }

  const models = options.models || { OrbitSignal };
  const acknowledgedAt = options.acknowledgedAt || new Date();
  const eventFilter = events.map((event) => ({
    _id: event.eventId,
    ...(event.occurredAt ? {
      $or: [
        { signaledAt: { $lte: event.occurredAt } },
        { signaledAt: null, createdAt: { $lte: event.occurredAt } },
        { signaledAt: { $exists: false }, createdAt: { $lte: event.occurredAt } },
      ],
    } : {}),
  }));
  const result = await models.OrbitSignal.updateMany(
    {
      $or: eventFilter,
      targetUser: user._id,
      type: "SEE_YOU",
      status: "active",
      $expr: {
        $or: [
          { $eq: ["$acknowledgedAt", null] },
          { $lt: ["$acknowledgedAt", { $ifNull: ["$signaledAt", "$createdAt"] }] },
        ],
      },
    },
    { $set: { acknowledgedAt } }
  );

  return {
    acknowledged: result.modifiedCount || 0,
    matched: result.matchedCount || 0,
  };
}

export const wallSeenTodayServiceTestUtils = {
  MAX_PEOPLE,
  validAcknowledgementEvents,
  validObjectIds,
};
