import PremiumMembership from "../models/PremiumMembership.js";
import Notification from "../models/Notification.js";
import Publication from "../models/Publication.js";
import WorldWaitlist from "../models/WorldWaitlist.js";
import { executeFinancialCommand } from "./financialCommandService.js";
import { creditWallet, debitWallet, transferStars, safeWallet } from "./walletLedgerService.js";
import { fingerprint, idempotencyKey } from "../validators/financialValidator.js";
import { PREMIUM_PRICE_PRESETS, PREMIUM_WORLD_DEFAULT_CAPACITY } from "../constants/publicationConstants.js";
import ApiError from "../utils/ApiError.js";
import { FINANCIAL_ERROR_CODES } from "../constants/financialConstants.js";

export const PREMIUM_PERIOD_DAYS = 30;
export const nextPremiumPeriod = (value) =>
  new Date(new Date(value).getTime() + PREMIUM_PERIOD_DAYS * 24 * 60 * 60 * 1000);

export const firstPremiumPeriodPrice = (regularPrice, introEnabled) => {
  const price = Number(regularPrice);
  return introEnabled ? Math.max(1, Math.ceil(price / 2)) : price;
};

const summary = (membership) => ({
  id: membership._id,
  publication: membership.premiumPublication,
  creator: membership.creator,
  status: membership.status,
  starsPerPeriod: membership.starsPerPeriod,
  firstPeriodStars: membership.firstPeriodStars || membership.starsPerPeriod,
  memberNumber: membership.memberNumber || null,
  currentPeriodStart: membership.currentPeriodStart,
  currentPeriodEnd: membership.currentPeriodEnd,
  cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
  autoRenew: membership.status === "ACTIVE" && !membership.cancelAtPeriodEnd,
});

const waitingSummary = async (entry, session = null) => {
  const query = WorldWaitlist.countDocuments({ publication: entry.publication, status: "WAITING", createdAt: { $lte: entry.createdAt } });
  if (session) query.session(session);
  return {
    id: entry._id,
    publication: entry.publication,
    status: entry.status,
    heldStars: entry.heldStars,
    regularPriceStars: entry.regularPriceStars,
    position: await query,
    createdAt: entry.createdAt,
  };
};

export async function joinPremium({ user, publicationId, key }) {
  key = idempotencyKey(key);
  return executeFinancialCommand(
    {
      user: user._id,
      commandType: "JOIN_PREMIUM",
      idempotencyKey: key,
      requestFingerprint: fingerprint({ publicationId: String(publicationId) }),
    },
    async (session, command) => {
      const publication = await Publication.findOne({
        _id: publicationId,
        kind: "PREMIUM_WORLD",
        status: { $in: ["PUBLISHED", "PENDING_REVIEW", "CHANGES_REQUESTED"] },
        publishedSnapshot: { $exists: true },
      }).session(session);
      if (!publication?.publishedSnapshot)
        throw new ApiError(
          409,
          "Premium World is not joinable",
          FINANCIAL_ERROR_CODES.PUBLICATION_NOT_PURCHASABLE,
        );
      if (String(publication.creator) === String(user._id))
        throw new ApiError(
          409,
          "Creators already have access to their own Premium World",
          FINANCIAL_ERROR_CODES.SELF_PURCHASE_NOT_REQUIRED,
        );

      const activeMembershipKey = `${user._id}:${publication.creator}`;
      if (await PremiumMembership.exists({ activeMembershipKey }).session(session))
        throw new ApiError(
          409,
          "Premium membership is already active",
          FINANCIAL_ERROR_CODES.MEMBERSHIP_ALREADY_ACTIVE,
        );

      const existingWaiting = await WorldWaitlist.findOne({ publication: publication._id, user: user._id, status: "WAITING" }).session(session);
      if (existingWaiting) return { resultReference: existingWaiting._id, queued: true, waitingList: await waitingSummary(existingWaiting, session), access: "WAITING_LIST" };

      const price = publication.publishedSnapshot.metadata?.pricing?.starsAmount;
      if (!PREMIUM_PRICE_PRESETS.includes(price))
        throw new ApiError(
          409,
          "Premium price is invalid",
          FINANCIAL_ERROR_CODES.PUBLICATION_NOT_PURCHASABLE,
        );
      const introEnabled = Boolean(publication.publishedSnapshot.metadata?.firstMonthOfferEnabled ?? publication.firstMonthOfferEnabled);
      const firstPeriodPrice = firstPremiumPeriodPrice(price, introEnabled);
      const capacity = publication.worldSeatCapacity ?? PREMIUM_WORLD_DEFAULT_CAPACITY;
      const occupied = await PremiumMembership.countDocuments({ premiumPublication: publication._id, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } }).session(session);
      if (occupied >= capacity) {
        const [waiting] = await WorldWaitlist.create([{
          publication: publication._id,
          creator: publication.creator,
          user: user._id,
          regularPriceStars: price,
          heldStars: firstPeriodPrice,
          introOfferApplied: introEnabled,
        }], { session });
        const held = await debitWallet({
          user: user._id,
          amount: firstPeriodPrice,
          entryType: "PREMIUM_WAITLIST_HOLD_DEBIT",
          entryRole: "FAN_HOLD",
          referenceType: "PREMIUM_WAITLIST",
          referenceId: waiting._id,
          publication: publication._id,
          creator: publication.creator,
          counterpartyUser: publication.creator,
          command,
          idempotencyKey: key,
          metadata: { regularPriceStars: price, introOfferApplied: introEnabled },
        }, session);
        waiting.holdLedgerEntry = held.entry._id;
        await waiting.save({ session });
        return { resultReference: waiting._id, queued: true, waitingList: await waitingSummary(waiting, session), wallet: safeWallet(held.wallet), access: "WAITING_LIST" };
      }
      const memberNumber = await PremiumMembership.countDocuments({ premiumPublication: publication._id }).session(session) + 1;

      const moved = await transferStars(
        {
          fromUser: user._id,
          toUser: publication.creator,
          amount: firstPeriodPrice,
          debitType: "PREMIUM_JOIN_DEBIT",
          creditType: "PREMIUM_CREATOR_EARNING",
          referenceType: "PREMIUM_JOIN",
          referenceId: publication._id,
          publication: publication._id,
          creator: publication.creator,
          command,
          idempotencyKey: key,
          metadata: { firstPeriodPriceStars: firstPeriodPrice, introOfferApplied: introEnabled, priceSnapshotStars: price, periodDays: PREMIUM_PERIOD_DAYS },
        },
        session,
      );
      const start = new Date();
      const end = nextPremiumPeriod(start);
      const [membership] = await PremiumMembership.create(
        [
          {
            user: user._id,
            creator: publication.creator,
            premiumPublication: publication._id,
            activeMembershipKey,
            status: "ACTIVE",
            starsPerPeriod: price,
            firstPeriodStars: firstPeriodPrice,
            memberNumber,
            currentPeriodStart: start,
            currentPeriodEnd: end,
            cancelAtPeriodEnd: false,
            latestLedgerEntry: moved.debit.entry._id,
            idempotencyKey: key,
          },
        ],
        { session },
      );
      return {
        resultReference: membership._id,
        membership: summary(membership),
        wallet: safeWallet(moved.debit.wallet),
        access: "ACTIVE_PREMIUM_MEMBER",
      };
    },
  );
}

export async function admitWorldWaitlist(publicationId) {
  const publication = await Publication.findById(publicationId).lean();
  if (!publication) throw new ApiError(404, "World not found", "PUBLICATION_NOT_FOUND");
  const capacity = publication.worldSeatCapacity ?? PREMIUM_WORLD_DEFAULT_CAPACITY;
  const occupied = await PremiumMembership.countDocuments({ premiumPublication: publicationId, status: { $in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] }, currentPeriodEnd: { $gt: new Date() } });
  const available = Math.max(0, capacity - occupied);
  if (!available) return { admitted: 0 };
  const waiting = await WorldWaitlist.find({ publication: publicationId, status: "WAITING" }).sort({ createdAt: 1, _id: 1 }).limit(available).lean();
  let admitted = 0;
  for (const row of waiting) {
    try {
      await executeFinancialCommand({
        user: row.user,
        commandType: "ADMIT_PREMIUM_WAITLIST",
        idempotencyKey: `waitlist-admit:${row._id}`,
        requestFingerprint: fingerprint({ waitlistId: String(row._id) }),
      }, async (session, command) => {
        const entry = await WorldWaitlist.findOne({ _id: row._id, status: "WAITING" }).session(session);
        if (!entry) return { resultReference: row._id, skipped: true };
        const activeMembershipKey = `${entry.user}:${entry.creator}`;
        const existing = await PremiumMembership.findOne({ activeMembershipKey }).session(session);
        if (existing) {
          await creditWallet({
            user: entry.user,
            amount: entry.heldStars,
            entryType: "PREMIUM_WAITLIST_REFUND_CREDIT",
            entryRole: "FAN_REFUND",
            referenceType: "PREMIUM_WAITLIST_DUPLICATE_REFUND",
            referenceId: entry._id,
            publication: entry.publication,
            creator: entry.creator,
            counterpartyUser: entry.creator,
            command,
            idempotencyKey: `waitlist-admit:${entry._id}`,
            reversalOf: entry.holdLedgerEntry,
            metadata: { reason: "MEMBERSHIP_ALREADY_ACTIVE" },
          }, session);
          entry.status = "CANCELLED";
          entry.cancelledAt = new Date();
          await entry.save({ session });
          return { resultReference: existing._id, membership: summary(existing), refundedDuplicate: true };
        }
        const memberNumber = await PremiumMembership.countDocuments({ premiumPublication: entry.publication }).session(session) + 1;
        const credited = await creditWallet({
          user: entry.creator,
          amount: entry.heldStars,
          earnedAmount: entry.heldStars,
          entryType: "PREMIUM_CREATOR_EARNING",
          entryRole: "CREATOR_EARNING",
          referenceType: "PREMIUM_WAITLIST_ADMISSION",
          referenceId: entry._id,
          publication: entry.publication,
          creator: entry.creator,
          counterpartyUser: entry.user,
          command,
          idempotencyKey: `waitlist-admit:${entry._id}`,
          metadata: { settlementStatus: "UNSETTLED", heldStars: entry.heldStars, priceSnapshotStars: entry.regularPriceStars },
        }, session);
        const start = new Date();
        const [membership] = await PremiumMembership.create([{
          user: entry.user,
          creator: entry.creator,
          premiumPublication: entry.publication,
          activeMembershipKey,
          status: "ACTIVE",
          starsPerPeriod: entry.regularPriceStars,
          firstPeriodStars: entry.heldStars,
          memberNumber,
          currentPeriodStart: start,
          currentPeriodEnd: nextPremiumPeriod(start),
          cancelAtPeriodEnd: false,
          latestLedgerEntry: entry.holdLedgerEntry || credited.entry._id,
          idempotencyKey: `waitlist-admit:${entry._id}`,
        }], { session });
        entry.status = "ADMITTED";
        entry.membership = membership._id;
        entry.admittedAt = new Date();
        await entry.save({ session });
        await Notification.create([{
          user: entry.user,
          type: "premium_waitlist_admitted",
          title: `You’re inside ${publication.title || "the World"}`,
          message: "A new wave opened and your reserved seat is now active.",
          dedupeKey: `premium-waitlist-admitted:${entry._id}`,
        }], { session });
        return { resultReference: membership._id, membership: summary(membership) };
      });
      admitted += 1;
    } catch {
      // Keep the reservation in FIFO order. A later wave/retry can admit it;
      // held Stars must never become stranded in a terminal state.
    }
  }
  return { admitted };
}

export async function cancelWorldWaitlist({ user, publicationId, key }) {
  key = idempotencyKey(key);
  return executeFinancialCommand({ user: user._id, commandType: "CANCEL_PREMIUM_WAITLIST", idempotencyKey: key, requestFingerprint: fingerprint({ publicationId: String(publicationId) }) }, async (session, command) => {
    const entry = await WorldWaitlist.findOne({ publication: publicationId, user: user._id, status: "WAITING" }).session(session);
    if (!entry) throw new ApiError(404, "Waiting-list reservation not found", "WAITLIST_NOT_FOUND");
    const refunded = await creditWallet({
      user: user._id,
      amount: entry.heldStars,
      entryType: "PREMIUM_WAITLIST_REFUND_CREDIT",
      entryRole: "FAN_REFUND",
      referenceType: "PREMIUM_WAITLIST_CANCEL",
      referenceId: entry._id,
      publication: entry.publication,
      creator: entry.creator,
      counterpartyUser: entry.creator,
      command,
      idempotencyKey: key,
      reversalOf: entry.holdLedgerEntry,
      metadata: { reason: "WAITLIST_CANCELLED" },
    }, session);
    entry.status = "CANCELLED";
    entry.cancelledAt = new Date();
    await entry.save({ session });
    return { resultReference: entry._id, cancelled: true, wallet: safeWallet(refunded.wallet) };
  });
}

export async function getWorldWaitlistStatus(userId, publicationId) {
  const entry = await WorldWaitlist.findOne({ publication: publicationId, user: userId, status: "WAITING" }).lean();
  return entry ? waitingSummary(entry) : null;
}

export async function cancelPremium({ user, membershipId, key }) {
  key = idempotencyKey(key);
  return executeFinancialCommand(
    {
      user: user._id,
      commandType: "CANCEL_PREMIUM",
      idempotencyKey: key,
      requestFingerprint: fingerprint({ membershipId: String(membershipId) }),
    },
    async (session) => {
      const membership = await PremiumMembership.findOne({
        _id: membershipId,
        user: user._id,
      }).session(session);
      if (!membership)
        throw new ApiError(404, "Membership not found", "MEMBERSHIP_NOT_FOUND");
      if (["EXPIRED", "CANCELED", "REFUNDED", "SUSPENDED"].includes(membership.status))
        throw new ApiError(409, "Membership is no longer active", "MEMBERSHIP_EXPIRED");
      if (membership.cancelAtPeriodEnd)
        return { resultReference: membership._id, membership: summary(membership) };

      membership.cancelAtPeriodEnd = true;
      membership.status = "CANCEL_AT_PERIOD_END";
      membership.canceledAt = new Date();
      membership.membershipVersion += 1;
      await membership.save({ session });
      return { resultReference: membership._id, membership: summary(membership) };
    },
  );
}

export async function resumePremium({ user, membershipId, key }) {
  key = idempotencyKey(key);
  return executeFinancialCommand(
    {
      user: user._id,
      commandType: "RESUME_PREMIUM",
      idempotencyKey: key,
      requestFingerprint: fingerprint({ membershipId: String(membershipId) }),
    },
    async (session) => {
      const membership = await PremiumMembership.findOne({
        _id: membershipId,
        user: user._id,
        status: "CANCEL_AT_PERIOD_END",
        currentPeriodEnd: { $gt: new Date() },
      }).session(session);
      if (!membership)
        throw new ApiError(409, "Membership cannot be resumed", "MEMBERSHIP_EXPIRED");
      membership.cancelAtPeriodEnd = false;
      membership.status = "ACTIVE";
      membership.canceledAt = null;
      membership.membershipVersion += 1;
      await membership.save({ session });
      return { resultReference: membership._id, membership: summary(membership) };
    },
  );
}

async function endCanceledMemberships(now) {
  await PremiumMembership.updateMany(
    {
      status: "CANCEL_AT_PERIOD_END",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { $lte: now },
    },
    {
      $set: {
        status: "CANCELED",
        endedAt: now,
      },
      $unset: { activeMembershipKey: 1 },
      $inc: { membershipVersion: 1 },
    },
  );
}

export async function renewPremiumMembership(membershipId, now = new Date()) {
  const due = await PremiumMembership.findOne({
    _id: membershipId,
    status: "ACTIVE",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: { $lte: now },
  }).lean();
  if (!due) return null;

  const periodStart = new Date(due.currentPeriodEnd);
  const periodEnd = nextPremiumPeriod(periodStart);
  const key = `premium-renew:${due._id}:${periodStart.toISOString()}`;
  try {
    return await executeFinancialCommand(
      {
        user: due.user,
        commandType: "RENEW_PREMIUM",
        idempotencyKey: key,
        requestFingerprint: fingerprint({
          membershipId: String(due._id),
          periodStart: periodStart.toISOString(),
        }),
      },
      async (session, command) => {
        const membership = await PremiumMembership.findOne({
          _id: due._id,
          status: "ACTIVE",
          cancelAtPeriodEnd: false,
          currentPeriodEnd: due.currentPeriodEnd,
        }).session(session);
        if (!membership)
          return { resultReference: due._id, skipped: true };

        const publication = await Publication.findOne({
          _id: membership.premiumPublication,
          kind: "PREMIUM_WORLD",
          status: { $in: ["PUBLISHED", "PENDING_REVIEW", "CHANGES_REQUESTED"] },
          publishedSnapshot: { $exists: true },
        }).session(session);
        if (!publication?.publishedSnapshot)
          throw new ApiError(
            409,
            "Premium World is no longer renewable",
            FINANCIAL_ERROR_CODES.PUBLICATION_NOT_PURCHASABLE,
          );

        const moved = await transferStars(
          {
            fromUser: membership.user,
            toUser: membership.creator,
            amount: membership.starsPerPeriod,
            debitType: "PREMIUM_RENEWAL_DEBIT",
            creditType: "PREMIUM_CREATOR_EARNING",
            referenceType: "PREMIUM_RENEWAL",
            referenceId: membership._id,
            publication: membership.premiumPublication,
            creator: membership.creator,
            command,
            idempotencyKey: key,
            metadata: {
              membershipId: String(membership._id),
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
              periodDays: PREMIUM_PERIOD_DAYS,
            },
          },
          session,
        );

        membership.currentPeriodStart = periodStart;
        membership.currentPeriodEnd = periodEnd;
        membership.latestLedgerEntry = moved.debit.entry._id;
        membership.membershipVersion += 1;
        await membership.save({ session });
        return {
          resultReference: membership._id,
          membership: summary(membership),
          wallet: safeWallet(moved.debit.wallet),
        };
      },
    );
  } catch (error) {
    if (
      [
        FINANCIAL_ERROR_CODES.INSUFFICIENT_STARS,
        FINANCIAL_ERROR_CODES.WALLET_UNAVAILABLE,
        FINANCIAL_ERROR_CODES.PUBLICATION_NOT_PURCHASABLE,
      ].includes(error.code)
    ) {
      await PremiumMembership.updateOne(
        {
          _id: due._id,
          status: "ACTIVE",
          currentPeriodEnd: due.currentPeriodEnd,
        },
        {
          $set: { status: "SUSPENDED", endedAt: now },
          $unset: { activeMembershipKey: 1 },
          $inc: { membershipVersion: 1 },
        },
      );
      return { resultReference: due._id, suspended: true, failureCode: error.code };
    }
    throw error;
  }
}

let renewalRunActive = false;
export async function processDuePremiumMemberships(now = new Date()) {
  if (renewalRunActive) return { skipped: true, processed: 0 };
  renewalRunActive = true;
  try {
    await endCanceledMemberships(now);
    const due = await PremiumMembership.find({
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: { $lte: now },
    })
      .select("_id")
      .sort({ currentPeriodEnd: 1 })
      .limit(50)
      .lean();
    const results = [];
    for (const membership of due) {
      try {
        results.push(await renewPremiumMembership(membership._id, now));
      } catch (error) {
        console.error("Premium membership renewal failed", {
          membershipId: String(membership._id),
          code: error.code || "RENEWAL_FAILED",
        });
      }
    }
    return { processed: results.length };
  } finally {
    renewalRunActive = false;
  }
}
