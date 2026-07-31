import DAWindow from "../models/DAWindow.js";
import CreatorProfile from "../models/CreatorProfile.js";
import Conversation from "../models/Conversation.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import PremiumMembership from "../models/PremiumMembership.js";
import Message from "../models/Message.js";
import PlatformRevenue from "../models/PlatformRevenue.js";
import { executeFinancialCommand } from "./financialCommandService.js";
import { creditWallet, debitWallet, safeWallet } from "./walletLedgerService.js";
import { fingerprint, idempotencyKey } from "../validators/financialValidator.js";
import { FINANCIAL_ERROR_CODES } from "../constants/financialConstants.js";
import ApiError from "../utils/ApiError.js";
import mongoose from "mongoose";

export const DA_WINDOW_MS = 48 * 60 * 60 * 1000;
export const DA_MESSAGE_LIMIT = 3;
export const DA_PLATFORM_RATE_BPS = 1000;
export const DA_REOPEN_PLATFORM_RATE_BPS = 2000;

const platformRateFor = (window) => (
  window.source === "CREATOR_REOPEN" ? DA_REOPEN_PLATFORM_RATE_BPS : DA_PLATFORM_RATE_BPS
);

export function serializeDAWindow(window) {
  if (!window) return null;
  if (window.id && window.fanId && window.creatorId) return window;
  return {
    id: String(window._id),
    fanId: String(window.fan?._id || window.fan),
    creatorId: String(window.creator?._id || window.creator),
    fan: window.fan?.name ? { id: String(window.fan._id), displayName: window.fan.name, username: window.fan.username, avatarUrl: window.fan.avatar || null } : null,
    creator: window.creator?.name ? { id: String(window.creator._id), displayName: window.creator.name, username: window.creator.username, avatarUrl: window.creator.avatar || null } : null,
    status: window.status,
    settlementStatus: window.settlementStatus,
    source: window.source,
    priceStars: window.priceStars,
    fanMessageLimit: window.fanMessageLimit,
    fanMessagesUsed: window.fanMessagesUsed,
    messagesRemaining: Math.max(0, window.fanMessageLimit - window.fanMessagesUsed),
    openedAt: window.openedAt,
    expiresAt: window.expiresAt,
    firstCreatorReplyAt: window.firstCreatorReplyAt,
    answeredAt: window.answeredAt,
    closedAt: window.closedAt,
    expiredAt: window.expiredAt,
    capturedAt: window.capturedAt,
    refundedAt: window.refundedAt,
    creatorQuestionMessageId: window.creatorQuestionMessage ? String(window.creatorQuestionMessage) : null,
    reopenedFromWindowId: window.reopenedFromWindow ? String(window.reopenedFromWindow) : null,
    threadRootWindowId: window.threadRootWindow ? String(window.threadRootWindow) : String(window._id),
    createdAt: window.createdAt,
    updatedAt: window.updatedAt,
  };
}

async function assertOpenPair(fan, creatorId) {
  if (fan.role !== "fan") throw new ApiError(403, "Only fans can open Direct Access windows");
  const creator = await User.findOne({ _id: creatorId, role: "creator", status: "active" }).select("_id name username avatar role");
  if (!creator) throw new ApiError(404, "Creator not found");
  const [profile, blocked] = await Promise.all([
    CreatorProfile.findOne({ user: creator._id }).select("directAccessEnabled directAccessPriceStars").lean(),
    UserBlock.exists({ $or: [{ blocker: fan._id, blocked: creator._id }, { blocker: creator._id, blocked: fan._id }] }),
  ]);
  if (blocked) throw new ApiError(403, "Direct Access is unavailable for this account");
  if (!profile?.directAccessEnabled) throw new ApiError(403, "This creator is not accepting Direct Access");
  return { creator, priceStars: profile.directAccessPriceStars || 100 };
}

export async function openDirectAccessWindow({ fan, creatorId, key, source = "PAID", creatorQuestionMessageId = null }) {
  key = idempotencyKey(key);
  if (!["PAID", "PREMIUM_INCLUDED", "CREATOR_REOPEN"].includes(source)) throw new ApiError(400, "This Direct Access source is not available");
  const { creator, priceStars } = await assertOpenPair(fan, creatorId);
  let creatorQuestion = null;
  let questionedWindow = null;
  if (source === "CREATOR_REOPEN") {
    creatorQuestion = await Message.findOne({ _id: creatorQuestionMessageId, sender: creator._id, recipient: fan._id, messageKind: "CREATOR_ASK" }).lean();
    if (!creatorQuestion) throw new ApiError(404, "Creator question not found");
    questionedWindow = await DAWindow.findOne({ _id: creatorQuestion.directAccessWindow, fan: fan._id, creator: creator._id }).lean();
    if (!questionedWindow) throw new ApiError(404, "Questioned Direct Access thread not found");
  }
  return executeFinancialCommand({
    user: fan._id,
    commandType: "OPEN_DA_WINDOW",
    idempotencyKey: key,
    requestFingerprint: fingerprint({ creatorId: String(creator._id), source, creatorQuestionMessageId, priceStars: source === "PREMIUM_INCLUDED" ? 0 : priceStars }),
  }, async (session, command) => {
    const activeWindowKey = `${fan._id}:${creator._id}`;
    const existing = await DAWindow.findOne({ activeWindowKey }).session(session);
    if (existing) throw new ApiError(409, "A Direct Access window is already open", FINANCIAL_ERROR_CODES.DA_WINDOW_ALREADY_OPEN);
    const now = new Date();
    let membership = null;
    if (source === "PREMIUM_INCLUDED") {
      membership = await PremiumMembership.findOneAndUpdate(
        {
          user: fan._id,
          creator: creator._id,
          status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] },
          currentPeriodEnd: { $gt: now },
          $or: [
            { $expr: { $ne: ["$directAccessAllowancePeriodStart", "$currentPeriodStart"] } },
            { directAccessAllowanceUsedAt: null },
          ],
        },
        [{ $set: { directAccessAllowanceUsedAt: now, directAccessAllowancePeriodStart: "$currentPeriodStart" } }],
        { new: true, session },
      );
      if (!membership) throw new ApiError(409, "Premium Direct Access allowance is unavailable", "DA_PREMIUM_ALLOWANCE_UNAVAILABLE");
    }
    const chargedStars = source === "PREMIUM_INCLUDED" ? 0 : priceStars;
    const [window] = await DAWindow.create([{
      fan: fan._id,
      creator: creator._id,
      activeWindowKey,
      status: "OPEN",
      settlementStatus: source === "PREMIUM_INCLUDED" ? "INCLUDED" : "HELD",
      source,
      priceStars: chargedStars,
      fanMessageLimit: DA_MESSAGE_LIMIT,
      fanMessagesUsed: 0,
      openedAt: now,
      expiresAt: new Date(now.getTime() + DA_WINDOW_MS),
      openingCommand: command._id,
      creatorQuestionMessage: creatorQuestion?._id || null,
      reopenedFromWindow: creatorQuestion?.directAccessWindow || null,
      threadRootWindow: questionedWindow?.threadRootWindow || questionedWindow?._id || null,
    }], { session });
    await Conversation.updateOne(
      { fan: fan._id, creator: creator._id },
      { $set: { status: "ACTIVE", acceptedAt: now, acceptedByCreator: true, declinedAt: null }, $setOnInsert: { fan: fan._id, creator: creator._id } },
      { upsert: true, session },
    );
    const held = source !== "PREMIUM_INCLUDED" ? await debitWallet({
      user: fan._id,
      amount: priceStars,
      entryType: "DA_HOLD_DEBIT",
      entryRole: "FAN_DA_HOLD",
      referenceType: "DIRECT_ACCESS_WINDOW",
      referenceId: window._id,
      creator: creator._id,
      counterpartyUser: creator._id,
      command,
      idempotencyKey: key,
      metadata: { settlementStatus: "HELD", expiresAt: window.expiresAt },
    }, session) : null;
    window.holdLedgerEntry = held?.entry?._id || null;
    if (!window.threadRootWindow) window.threadRootWindow = window._id;
    await window.save({ session });
    await Notification.create([{
      user: creator._id,
      type: "direct_access_opened",
      title: `${fan.name || "A fan"} opened Direct Access`,
      dedupeKey: `da-open:${window._id}`,
    }], { session });
    return { resultReference: window._id, window: serializeDAWindow(window), wallet: held ? safeWallet(held.wallet) : null };
  });
}

export async function refundDirectAccessWindow(windowId, now = new Date()) {
  const candidate = await DAWindow.findById(windowId).lean();
  if (!candidate || candidate.settlementStatus !== "HELD") return candidate ? { window: serializeDAWindow(candidate), changed: false } : null;
  const key = `da-refund:${candidate._id}`;
  return executeFinancialCommand({
    user: candidate.fan,
    commandType: "REFUND_DA_WINDOW",
    idempotencyKey: key,
    requestFingerprint: fingerprint({ windowId: String(candidate._id), priceStars: candidate.priceStars }),
  }, async (session, command) => {
    const window = await DAWindow.findOne({ _id: windowId, settlementStatus: "HELD" }).session(session);
    if (!window) {
      const current = await DAWindow.findById(windowId).session(session);
      return { resultReference: windowId, window: serializeDAWindow(current), changed: false };
    }
    const held = await StarsLedgerEntry.findById(window.holdLedgerEntry).session(session);
    const refunded = await creditWallet({
      user: window.fan,
      amount: window.priceStars,
      entryType: "DA_REFUND_CREDIT",
      entryRole: "FAN_DA_REFUND",
      referenceType: "DIRECT_ACCESS_WINDOW",
      referenceId: window._id,
      creator: window.creator,
      counterpartyUser: window.creator,
      command,
      idempotencyKey: key,
      reversalOf: held?._id,
      metadata: { reason: "UNANSWERED_EXPIRY" },
    }, session);
    window.status = "EXPIRED";
    window.settlementStatus = "REFUNDED";
    window.expiredAt = now;
    window.refundedAt = now;
    window.closedAt = now;
    window.refundCommand = command._id;
    window.refundLedgerEntry = refunded.entry._id;
    window.activeWindowKey = undefined;
    window.version += 1;
    await window.save({ session });
    await Notification.create([{
      user: window.fan,
      type: "direct_access_refunded",
      title: `Your ${window.priceStars} Stars were refunded`,
      dedupeKey: `da-refund:${window._id}`,
    }], { session });
    return { resultReference: window._id, window: serializeDAWindow(window), wallet: safeWallet(refunded.wallet), changed: true };
  });
}

export async function captureDirectAccessWindow(windowId, creatorId, now = new Date()) {
  const candidate = await DAWindow.findOne({ _id: windowId, creator: creatorId }).lean();
  if (!candidate) throw new ApiError(404, "Direct Access window not found");
  if (candidate.expiresAt <= now && candidate.settlementStatus === "HELD") {
    await refundDirectAccessWindow(candidate._id, now);
    throw new ApiError(409, "Direct Access window expired", FINANCIAL_ERROR_CODES.DA_WINDOW_CLOSED);
  }
  if (candidate.settlementStatus === "CAPTURED") return { window: serializeDAWindow(candidate), changed: false };
  if (candidate.settlementStatus !== "HELD") throw new ApiError(409, "Direct Access window is not capturable", FINANCIAL_ERROR_CODES.DA_WINDOW_CLOSED);
  const key = `da-capture:${candidate._id}`;
  return executeFinancialCommand({
    user: creatorId,
    commandType: "CAPTURE_DA_WINDOW",
    idempotencyKey: key,
    requestFingerprint: fingerprint({ windowId: String(candidate._id), priceStars: candidate.priceStars }),
  }, async (session, command) => {
    const window = await DAWindow.findOne({ _id: candidate._id, creator: creatorId, settlementStatus: "HELD", expiresAt: { $gt: now } }).session(session);
    if (!window) throw new ApiError(409, "Direct Access window is no longer capturable", FINANCIAL_ERROR_CODES.DA_WINDOW_CLOSED);
    const platformRateBasisPoints = platformRateFor(window);
    const platformStars = Math.floor((window.priceStars * platformRateBasisPoints) / 10000);
    const creatorStars = window.priceStars - platformStars;
    const earned = await creditWallet({
      user: window.creator,
      amount: creatorStars,
      entryType: "DA_CREATOR_EARNING",
      entryRole: "CREATOR_DA_EARNING",
      referenceType: "DIRECT_ACCESS_WINDOW",
      referenceId: window._id,
      creator: window.creator,
      counterpartyUser: window.fan,
      command,
      idempotencyKey: key,
      metadata: { settlementStatus: "CAPTURED", grossStars: window.priceStars, creatorStars, platformStars, platformRateBasisPoints },
    }, session);
    const [revenue] = await PlatformRevenue.create([{
      sourceType: "DIRECT_ACCESS",
      referenceId: String(window._id),
      fan: window.fan,
      creator: window.creator,
      grossStars: window.priceStars,
      creatorStars,
      platformStars,
      rateBasisPoints: platformRateBasisPoints,
      command: command._id,
      capturedAt: now,
    }], { session });
    if (window.status !== "CLOSED") window.status = "ANSWERED";
    window.settlementStatus = "CAPTURED";
    window.firstCreatorReplyAt = now;
    window.answeredAt = now;
    window.capturedAt = now;
    window.captureCommand = command._id;
    window.creatorEarningLedgerEntry = earned.entry._id;
    window.platformRevenue = revenue._id;
    window.version += 1;
    await window.save({ session });
    await Notification.create([{
      user: window.fan,
      type: "direct_access_answered",
      title: "Your Direct Access question was answered",
      dedupeKey: `da-answer:${window._id}`,
    }], { session });
    return { resultReference: window._id, window: serializeDAWindow(window), wallet: safeWallet(earned.wallet), changed: true };
  });
}

export async function processDueDirectAccessWindows(now = new Date(), io = null) {
  const due = await DAWindow.find({ status: { $in: ["OPEN", "CLOSED"] }, settlementStatus: "HELD", expiresAt: { $lte: now } }).select("_id").limit(200).lean();
  const results = [];
  for (const item of due) {
    try {
      const result = await refundDirectAccessWindow(item._id, now);
      results.push(result);
      if (result?.window) io?.to(`user:${result.window.fanId}`).to(`user:${result.window.creatorId}`).emit("direct-access:updated", result.window);
    }
    catch (error) {
      await DAWindow.updateOne({ _id: item._id, settlementStatus: "HELD" }, { $set: { settlementStatus: "REFUND_PENDING" } }).catch(() => {});
      console.error("Direct Access refund failed", { windowId: String(item._id), code: error.code || "ERROR" });
    }
  }
  const answered = await DAWindow.updateMany(
    { status: "ANSWERED", expiresAt: { $lte: now } },
    { $set: { status: "CLOSED", closedAt: now }, $unset: { activeWindowKey: 1 }, $inc: { version: 1 } },
  );
  const included = await DAWindow.updateMany(
    { status: "OPEN", settlementStatus: "INCLUDED", expiresAt: { $lte: now } },
    { $set: { status: "EXPIRED", expiredAt: now, closedAt: now }, $unset: { activeWindowKey: 1 }, $inc: { version: 1 } },
  );
  return { refunded: results.length, closed: answered.modifiedCount + included.modifiedCount };
}

export async function activeDirectAccessWindow(fanId, creatorId) {
  const window = await DAWindow.findOne({ activeWindowKey: `${fanId}:${creatorId}` });
  if (window?.expiresAt <= new Date()) {
    if (window.settlementStatus === "HELD") await refundDirectAccessWindow(window._id);
    else {
      await DAWindow.updateOne({ _id: window._id }, { $set: { status: "CLOSED", closedAt: new Date() }, $unset: { activeWindowKey: 1 }, $inc: { version: 1 } });
    }
    return DAWindow.findById(window._id);
  }
  return window;
}

export async function latestDirectAccessWindow(fanId, creatorId) {
  const active = await activeDirectAccessWindow(fanId, creatorId);
  return active || DAWindow.findOne({ fan: fanId, creator: creatorId }).sort({ createdAt: -1 });
}

export async function reserveDirectAccessMessage({ windowId, sender, recipient, now = new Date() }) {
  if (!windowId) return null;
  const window = await DAWindow.findById(windowId);
  if (!window) throw new ApiError(404, "Direct Access window not found");
  const senderId = String(sender._id);
  const expectedFan = String(window.fan);
  const expectedCreator = String(window.creator);
  if (!(
    (senderId === expectedFan && String(recipient._id) === expectedCreator)
    || (senderId === expectedCreator && String(recipient._id) === expectedFan)
  )) throw new ApiError(403, "Direct Access window does not belong to this conversation");
  if (window.expiresAt <= now || !["OPEN", "ANSWERED"].includes(window.status)) {
    if (window.settlementStatus === "HELD") await refundDirectAccessWindow(window._id, now);
    throw new ApiError(409, "Direct Access window is closed", FINANCIAL_ERROR_CODES.DA_WINDOW_CLOSED);
  }
  if (sender.role === "fan") {
    const reserved = await DAWindow.findOneAndUpdate(
      {
        _id: window._id,
        fan: sender._id,
        status: { $in: ["OPEN", "ANSWERED"] },
        expiresAt: { $gt: now },
        fanMessagesUsed: { $lt: window.fanMessageLimit },
      },
      { $inc: { fanMessagesUsed: 1, version: 1 } },
      { new: true },
    );
    if (!reserved) throw new ApiError(409, "Direct Access message limit reached", FINANCIAL_ERROR_CODES.DA_MESSAGE_LIMIT_REACHED);
    return { window: reserved, reservedFanSlot: true };
  }
  return { window, reservedFanSlot: false };
}

export async function releaseDirectAccessMessageReservation(prepared) {
  if (!prepared?.reservedFanSlot) return;
  await DAWindow.updateOne(
    { _id: prepared.window._id, fanMessagesUsed: { $gt: 0 } },
    { $inc: { fanMessagesUsed: -1, version: 1 } },
  );
}

export async function settleDirectAccessReply(prepared, sender) {
  if (!prepared || sender.role !== "creator") {
    return prepared?.window || null;
  }
  if (prepared.window.settlementStatus === "INCLUDED") {
    return DAWindow.findOneAndUpdate(
      { _id: prepared.window._id, creator: sender._id, status: "OPEN", settlementStatus: "INCLUDED", expiresAt: { $gt: new Date() } },
      { $set: { status: "ANSWERED", firstCreatorReplyAt: new Date(), answeredAt: new Date() }, $inc: { version: 1 } },
      { new: true },
    );
  }
  if (prepared.window.settlementStatus !== "HELD") return prepared.window;
  const result = await captureDirectAccessWindow(prepared.window._id, sender._id);
  return result.window;
}

async function strictTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (error) {
    if (/Transaction numbers are only allowed|does not support transactions|replica set/i.test(error?.message || "")) {
      throw new ApiError(503, "Direct Access requires MongoDB transaction support", FINANCIAL_ERROR_CODES.TRANSACTIONS_REQUIRED);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function createDirectAccessMessageAtomic({ windowId, sender, recipient, message, now = new Date() }) {
  if (!windowId) return null;
  const existing = await Message.findOne({ sender: sender._id, clientMessageId: message.clientMessageId });
  if (existing) return { message: existing, window: await DAWindow.findById(existing.directAccessWindow), replay: true };
  const snapshot = await DAWindow.findById(windowId);
  if (!snapshot) throw new ApiError(404, "Direct Access window not found");
  const isFan = String(snapshot.fan) === String(sender._id) && String(snapshot.creator) === String(recipient._id);
  const isCreator = String(snapshot.creator) === String(sender._id) && String(snapshot.fan) === String(recipient._id);
  if (!isFan && !isCreator) throw new ApiError(403, "Direct Access window does not belong to this conversation");
  const fanCanSend = isFan && ["OPEN", "ANSWERED"].includes(snapshot.status);
  const creatorCanReply = isCreator && ["OPEN", "ANSWERED", "CLOSED"].includes(snapshot.status);
  if (snapshot.expiresAt <= now || (!fanCanSend && !creatorCanReply)) throw new ApiError(409, "Direct Access window is closed", FINANCIAL_ERROR_CODES.DA_WINDOW_CLOSED);

  if (isCreator && snapshot.settlementStatus === "HELD") {
    const key = `da-capture:${snapshot._id}`;
    return executeFinancialCommand({
      user: sender._id,
      commandType: "CAPTURE_DA_WINDOW",
      idempotencyKey: key,
      requestFingerprint: fingerprint({ windowId: String(snapshot._id), priceStars: snapshot.priceStars }),
    }, async (session, command) => {
      const window = await DAWindow.findOne({ _id: snapshot._id, creator: sender._id, status: { $in: ["OPEN", "ANSWERED", "CLOSED"] }, settlementStatus: "HELD", expiresAt: { $gt: now } }).session(session);
      if (!window) throw new ApiError(409, "Direct Access window is no longer capturable", FINANCIAL_ERROR_CODES.DA_WINDOW_CLOSED);
      const [created] = await Message.create([{ ...message, sender: sender._id, recipient: recipient._id, messageChannel: "DIRECT_ACCESS", directAccessWindow: window._id }], { session });
      const platformRateBasisPoints = platformRateFor(window);
      const platformStars = Math.floor((window.priceStars * platformRateBasisPoints) / 10000);
      const creatorStars = window.priceStars - platformStars;
      const earned = await creditWallet({ user: window.creator, amount: creatorStars, entryType: "DA_CREATOR_EARNING", entryRole: "CREATOR_DA_EARNING", referenceType: "DIRECT_ACCESS_WINDOW", referenceId: window._id, creator: window.creator, counterpartyUser: window.fan, command, idempotencyKey: key, metadata: { settlementStatus: "CAPTURED", grossStars: window.priceStars, creatorStars, platformStars, platformRateBasisPoints } }, session);
      const [revenue] = await PlatformRevenue.create([{ sourceType: "DIRECT_ACCESS", referenceId: String(window._id), fan: window.fan, creator: window.creator, grossStars: window.priceStars, creatorStars, platformStars, rateBasisPoints: platformRateBasisPoints, command: command._id, capturedAt: now }], { session });
      Object.assign(window, { status: window.status === "CLOSED" ? "CLOSED" : "ANSWERED", settlementStatus: "CAPTURED", firstCreatorReplyAt: now, answeredAt: now, capturedAt: now, captureCommand: command._id, creatorEarningLedgerEntry: earned.entry._id, platformRevenue: revenue._id, version: window.version + 1 });
      await window.save({ session });
      await Notification.create([{ user: window.fan, type: "direct_access_answered", title: "Your Direct Access question was answered", dedupeKey: `da-answer:${window._id}` }], { session });
      return { resultReference: window._id, message: created.toObject(), window: serializeDAWindow(window), replay: false };
    });
  }

  return strictTransaction(async (session) => {
    const filter = { _id: snapshot._id, status: { $in: isFan ? ["OPEN", "ANSWERED"] : ["OPEN", "ANSWERED", "CLOSED"] }, expiresAt: { $gt: now } };
    const update = { $inc: { version: 1 } };
    if (isFan) {
      filter.fan = sender._id;
      filter.fanMessagesUsed = { $lt: snapshot.fanMessageLimit };
      update.$inc.fanMessagesUsed = 1;
    }
    if (isCreator) filter.creator = sender._id;
    if (isCreator && snapshot.settlementStatus === "INCLUDED" && !snapshot.firstCreatorReplyAt) {
      update.$set = {
        ...(snapshot.status === "CLOSED" ? {} : { status: "ANSWERED" }),
        firstCreatorReplyAt: now,
        answeredAt: now,
      };
    }
    const window = await DAWindow.findOneAndUpdate(filter, update, { new: true, session });
    if (!window) throw new ApiError(409, isFan ? "Direct Access message limit reached" : "Direct Access window is closed", isFan ? FINANCIAL_ERROR_CODES.DA_MESSAGE_LIMIT_REACHED : FINANCIAL_ERROR_CODES.DA_WINDOW_CLOSED);
    const [created] = await Message.create([{ ...message, sender: sender._id, recipient: recipient._id, messageChannel: "DIRECT_ACCESS", directAccessWindow: window._id }], { session });
    if (isFan && window.fanMessagesUsed >= window.fanMessageLimit) {
      window.status = "CLOSED";
      window.closedAt = now;
      window.activeWindowKey = undefined;
      await window.save({ session });
    }
    return { message: created, window, replay: false };
  });
}
