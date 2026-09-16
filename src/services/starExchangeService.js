import FinancialSetting from "../models/FinancialSetting.js";

export const DEFAULT_STARS_PER_USD = 10;

export async function getStarExchangeRate() {
  const setting = await FinancialSetting.findOne({ key: "STAR_EXCHANGE_RATE" }).lean();
  return Number(setting?.starsPerUsd || DEFAULT_STARS_PER_USD);
}

export async function setStarExchangeRate(starsPerUsd, updatedBy) {
  return FinancialSetting.findOneAndUpdate(
    { key: "STAR_EXCHANGE_RATE" },
    { $set: { starsPerUsd, updatedBy } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
}
