import PlatformSetting from "../models/PlatformSetting.js";
import ApiError from "../utils/ApiError.js";

export const WEB_COIN_USD = 0.149;
export const WEB_COIN_PACKS = Object.freeze([
  Object.freeze({ id: "WEB_50", stars: 50, bonusStars: 0, subtotalUsd: 7.49, badge: null }),
  Object.freeze({ id: "WEB_100", stars: 100, bonusStars: 5, subtotalUsd: 14.99, badge: null }),
  Object.freeze({ id: "WEB_300", stars: 300, bonusStars: 20, subtotalUsd: 44.99, badge: null }),
  Object.freeze({ id: "WEB_500", stars: 500, bonusStars: 50, subtotalUsd: 74.49, badge: "popular" }),
  Object.freeze({ id: "WEB_1000", stars: 1000, bonusStars: 150, subtotalUsd: 148.99, badge: "best_value" }),
  Object.freeze({ id: "WEB_2500", stars: 2500, bonusStars: 500, subtotalUsd: 372.49, badge: null }),
]);

const TAX_KEY = "WEB_COIN_TAX_RATE";
export async function getWebCoinTaxRate() {
  const row = await PlatformSetting.findOne({ key: TAX_KEY }).lean();
  const rate = Number(row?.value?.percent || 0);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0;
}

export async function setWebCoinTaxRate(percent, updatedBy) {
  percent = Number(percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new ApiError(400, "Tax rate must be between 0 and 100 percent", "INVALID_TAX_RATE");
  percent = Math.round(percent * 1000) / 1000;
  await PlatformSetting.findOneAndUpdate({ key: TAX_KEY }, { $set: { value: { percent }, updatedBy } }, { upsert: true, new: true, runValidators: true });
  return percent;
}

export const priceWithTax = (subtotalUsd, taxPercent) => {
  const taxUsd = Number((Number(subtotalUsd) * Number(taxPercent) / 100).toFixed(2));
  return { subtotalUsd: Number(subtotalUsd), taxPercent: Number(taxPercent), taxUsd, totalUsd: Number((Number(subtotalUsd) + taxUsd).toFixed(2)) };
};

export function packByPrice(value) {
  const price = Number(value);
  return WEB_COIN_PACKS.find((pack) => pack.subtotalUsd === price) || null;
}
