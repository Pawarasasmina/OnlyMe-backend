import PremiumMembership from "../models/PremiumMembership.js";
import Publication from "../models/Publication.js";
import { executeFinancialCommand } from "./financialCommandService.js";
import { transferStars, safeWallet } from "./walletLedgerService.js";
import { fingerprint, idempotencyKey } from "../validators/financialValidator.js";
import ApiError from "../utils/ApiError.js";
import { FINANCIAL_ERROR_CODES } from "../constants/financialConstants.js";

export const PREMIUM_PERIOD_DAYS = 30;
export const nextPremiumPeriod = (value) =>
  new Date(new Date(value).getTime() + PREMIUM_PERIOD_DAYS * 24 * 60 * 60 * 1000);

const summary = (membership) => ({
  id: membership._id,
  publication: membership.premiumPublication,
  creator: membership.creator,
  status: membership.status,
  starsPerPeriod: membership.starsPerPeriod,
  currentPeriodStart: membership.currentPeriodStart,
  currentPeriodEnd: membership.currentPeriodEnd,
  cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
  autoRenew: membership.status === "ACTIVE" && !membership.cancelAtPeriodEnd,
});

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

      const price = publication.publishedSnapshot.metadata?.pricing?.starsAmount;
      if (![90, 190, 290].includes(price))
        throw new ApiError(
          409,
          "Premium price is invalid",
          FINANCIAL_ERROR_CODES.PUBLICATION_NOT_PURCHASABLE,
        );

      const moved = await transferStars(
        {
          fromUser: user._id,
          toUser: publication.creator,
          amount: price,
          debitType: "PREMIUM_JOIN_DEBIT",
          creditType: "PREMIUM_CREATOR_EARNING",
          referenceType: "PREMIUM_JOIN",
          referenceId: publication._id,
          publication: publication._id,
          creator: publication.creator,
          command,
          idempotencyKey: key,
          metadata: { priceSnapshotStars: price, periodDays: PREMIUM_PERIOD_DAYS },
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
