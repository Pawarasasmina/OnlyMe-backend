import FinancialSetting from "../models/FinancialSetting.js";
import ApiError from "../utils/ApiError.js";

export const DEFAULT_STARS_PER_USD = 10;

export async function getStarExchangeRate() {
  return DEFAULT_STARS_PER_USD;
}

export async function setStarExchangeRate(starsPerUsd, updatedBy) {
  if (starsPerUsd !== DEFAULT_STARS_PER_USD) throw new ApiError(400, "The exchange rate is fixed at 10 coins per USD", "INVALID_STAR_EXCHANGE_RATE");
  return FinancialSetting.findOneAndUpdate(
    { key: "STAR_EXCHANGE_RATE" },
    { $set: { starsPerUsd, updatedBy } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
}
