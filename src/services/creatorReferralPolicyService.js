import PlatformSetting from "../models/PlatformSetting.js";
import ApiError from "../utils/ApiError.js";

const KEY = "CREATOR_REFERRAL_POLICY";
export const DEFAULT_CREATOR_REFERRAL_POLICY = Object.freeze({
  enabled: false,
  rewardPerTenUsd: 1,
  eligibleMonths: 12,
  firstPayoutDays: 60,
  minimumCreatorMonthlyUsd: 25,
  creatorMarginCapPercent: 50,
  monthlyNetRevenueCapPercent: 35,
  assumedPlatformMarginPercent: 20,
});

const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export async function getCreatorReferralPolicy() {
  const row = await PlatformSetting.findOne({ key: KEY }).lean();
  return { ...DEFAULT_CREATOR_REFERRAL_POLICY, ...(row?.value || {}) };
}

export async function setCreatorReferralPolicy(value, updatedBy) {
  const policy = {
    ...DEFAULT_CREATOR_REFERRAL_POLICY,
    enabled: value.enabled === true,
    creatorMarginCapPercent: number(value.creatorMarginCapPercent, 50),
    monthlyNetRevenueCapPercent: number(value.monthlyNetRevenueCapPercent, 35),
    assumedPlatformMarginPercent: number(value.assumedPlatformMarginPercent, 20),
  };
  if (policy.creatorMarginCapPercent < 0 || policy.creatorMarginCapPercent > 50) throw new ApiError(400, "Per-creator margin cap must be between 0 and 50 percent", "INVALID_REFERRAL_MARGIN_CAP");
  if (policy.monthlyNetRevenueCapPercent < 0 || policy.monthlyNetRevenueCapPercent > 35) throw new ApiError(400, "Monthly net revenue cap must be between 0 and 35 percent", "INVALID_REFERRAL_REVENUE_CAP");
  if (policy.assumedPlatformMarginPercent < 0 || policy.assumedPlatformMarginPercent > 100) throw new ApiError(400, "Platform margin must be between 0 and 100 percent", "INVALID_PLATFORM_MARGIN");
  await PlatformSetting.findOneAndUpdate({ key: KEY }, { $set: { value: policy, updatedBy } }, { upsert: true, runValidators: true });
  return policy;
}
