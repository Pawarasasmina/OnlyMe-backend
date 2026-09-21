import mongoose from "mongoose";
import PremiumMembership from "../models/PremiumMembership.js";
import Publication from "../models/Publication.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import {
  PREMIUM_CREATOR_PAYOUT_SHARE,
  PREMIUM_PRICE_CHANGE_COOLDOWN_DAYS,
  PREMIUM_PRICE_PRESETS,
  PREMIUM_PRICE_TOP_TIER,
  PREMIUM_PRICE_TOP_TIER_MIN_RESIDENTS,
  PREMIUM_PRICE_TOP_TIER_RENEWAL_MONTHS,
} from "../constants/publicationConstants.js";
import { getStarExchangeRate } from "./starExchangeService.js";
import ApiError from "../utils/ApiError.js";

const ACTIVE_MEMBERSHIP_STATUSES = ["ACTIVE", "CANCEL_AT_PERIOD_END"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function nextPriceChangeAt(lastChangedAt) {
  if (!lastChangedAt) return null;
  return new Date(new Date(lastChangedAt).getTime() + PREMIUM_PRICE_CHANGE_COOLDOWN_DAYS * MS_PER_DAY);
}

function money(amount) {
  return Math.round(Number(amount || 0) * 100) / 100;
}

export function creatorPayoutForStars(stars, starsPerUsd) {
  return {
    amount: money((Number(stars) / Number(starsPerUsd || 10)) * PREMIUM_CREATOR_PAYOUT_SHARE),
    currency: "USD",
  };
}

async function activeResidentCount(publicationId, session = null) {
  return PremiumMembership.countDocuments({
    premiumPublication: publicationId,
    status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
    currentPeriodEnd: { $gt: new Date() },
  }).session(session);
}

async function steadyRenewalStatus(publicationId, residentCount, session = null) {
  const since = new Date(Date.now() - PREMIUM_PRICE_TOP_TIER_RENEWAL_MONTHS * PREMIUM_PRICE_CHANGE_COOLDOWN_DAYS * MS_PER_DAY);
  const renewalCount = await StarsLedgerEntry.countDocuments({
    publication: publicationId,
    entryType: "PREMIUM_RENEWAL_DEBIT",
    createdAt: { $gte: since },
  }).session(session);
  return {
    requiredMonths: PREMIUM_PRICE_TOP_TIER_RENEWAL_MONTHS,
    renewalCount,
    steady: renewalCount >= Math.max(1, residentCount),
  };
}

async function topTierEligibility(publicationId, session = null) {
  const residentCount = await activeResidentCount(publicationId, session);
  const renewals = await steadyRenewalStatus(publicationId, residentCount, session);
  const eligible = residentCount >= PREMIUM_PRICE_TOP_TIER_MIN_RESIDENTS && renewals.steady;
  return {
    eligible,
    residentCount,
    minResidents: PREMIUM_PRICE_TOP_TIER_MIN_RESIDENTS,
    steadyRenewals: renewals.steady,
    renewalCount: renewals.renewalCount,
    reason: eligible ? "" : "Requires 100+ residents with steady renewals",
  };
}

function priceHistoryItem(previousStarsAmount, price, changedBy, now) {
  const current = Number(previousStarsAmount || 0);
  return {
    previousStarsAmount: Number.isSafeInteger(current) && current > 0 ? current : null,
    starsAmount: price,
    changedBy,
    changedAt: now,
  };
}

function tierRows({ currentPrice, topTier, starsPerUsd }) {
  return PREMIUM_PRICE_PRESETS.map((coins) => {
    const locked = coins === PREMIUM_PRICE_TOP_TIER && !topTier.eligible;
    return {
      coins,
      available: !locked,
      locked,
      reason: locked ? topTier.reason : "",
      current: coins === currentPrice,
      payout: creatorPayoutForStars(coins, starsPerUsd),
    };
  });
}

export async function serializePremiumWorldPricing(publication, { session = null } = {}) {
  if (publication.kind !== "PREMIUM_WORLD") throw new ApiError(409, "Only Premium Worlds have subscription pricing", "UNSUPPORTED_WORLD_PRICING");
  const [starsPerUsd, topTier] = await Promise.all([
    getStarExchangeRate(),
    topTierEligibility(publication._id, session),
  ]);
  const currentPrice = Number(publication.pricing?.starsAmount || publication.publishedSnapshot?.metadata?.pricing?.starsAmount || 0);
  const cooldownUntil = nextPriceChangeAt(publication.pricingLastChangedAt);
  const now = new Date();
  const canChangePrice = !cooldownUntil || cooldownUntil <= now;
  return {
    currentPrice,
    currentTier: currentPrice,
    tiers: tierRows({ currentPrice, topTier, starsPerUsd }),
    canChangePrice,
    cooldownDays: PREMIUM_PRICE_CHANGE_COOLDOWN_DAYS,
    lastPriceChangedAt: publication.pricingLastChangedAt || null,
    nextPriceChangeAt: cooldownUntil,
    topTierEligibility: topTier,
    firstMonthOfferEnabled: Boolean(publication.firstMonthOfferEnabled),
    memberPriceLocked: publication.memberPriceLocked !== false,
    creatorPayout: creatorPayoutForStars(currentPrice, starsPerUsd),
    starsPerUsd,
    creatorPayoutShare: PREMIUM_CREATOR_PAYOUT_SHARE,
    copy: {
      description: "Monthly subscription. Everyone already inside keeps their price forever — the new price is for new residents only.",
      helper: "Top tier ✦1,000 — opens at 100+ residents with steady renewals. First month -50% for newcomers stays on. Change once every 30 days.",
    },
  };
}

export async function updatePremiumWorldPricing({ creatorId, publicationId, monthlyStars }) {
  if (!mongoose.isValidObjectId(publicationId)) throw new ApiError(400, "Invalid publication ID");
  const price = Number(monthlyStars);
  if (!Number.isSafeInteger(price) || price < 1) throw new ApiError(400, "Choose a supported World price", "INVALID_WORLD_PRICE");
  if (!PREMIUM_PRICE_PRESETS.includes(price)) throw new ApiError(400, "Choose a supported World price", "INVALID_WORLD_PRICE");

  const publication = await Publication.findOne({
    _id: publicationId,
    creator: creatorId,
    kind: "PREMIUM_WORLD",
    status: { $ne: "REMOVED" },
  }).select("+submittedSnapshot +shareToken");
  if (!publication) throw new ApiError(404, "Premium World not found", "WORLD_NOT_FOUND");

  const currentPrice = Number(publication.pricing?.starsAmount || 0);
  if (currentPrice === price) return { publication, pricing: await serializePremiumWorldPricing(publication) };

  const cooldownUntil = nextPriceChangeAt(publication.pricingLastChangedAt);
  if (cooldownUntil && cooldownUntil > new Date()) {
    throw new ApiError(409, `You can change your World price again on ${cooldownUntil.toISOString()}`, "PRICE_CHANGE_COOLDOWN");
  }

  if (price === PREMIUM_PRICE_TOP_TIER) {
    const topTier = await topTierEligibility(publication._id);
    if (!topTier.eligible) throw new ApiError(409, topTier.reason, "PRICE_TIER_LOCKED");
  }

  const now = new Date();
  publication.pricing = { mode: "MONTHLY", starsAmount: price, presetId: `premium-${price}` };
  publication.pricingLastChangedAt = now;
  publication.priceHistory = [...(publication.priceHistory || []), priceHistoryItem(currentPrice, price, creatorId, now)].slice(-50);
  publication.statusVersion += 1;
  if (publication.publishedSnapshot?.metadata) {
    publication.publishedSnapshot.metadata = {
      ...publication.publishedSnapshot.metadata,
      pricing: publication.pricing,
      pricingLastChangedAt: now,
      priceHistory: publication.priceHistory,
    };
  }
  if (publication.submittedSnapshot?.metadata) {
    publication.submittedSnapshot.metadata = {
      ...publication.submittedSnapshot.metadata,
      pricing: publication.pricing,
      pricingLastChangedAt: now,
      priceHistory: publication.priceHistory,
    };
  }
  await publication.save();
  return { publication, pricing: await serializePremiumWorldPricing(publication) };
}
