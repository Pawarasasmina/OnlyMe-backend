import Gift from "../models/Gift.js";
import GiftCategory from "../models/GiftCategory.js";
import GiftPreference from "../models/GiftPreference.js";

export const serializeGift = (gift) => ({ id: String(gift._id), key: String(gift._id), name: gift.name, stars: gift.stars, imageUrl: gift.image.url, isAnimated: Boolean(gift.image?.isAnimated), displayScale: gift.displayScale || 100, imagePositionX: gift.imagePositionX || 0, imagePositionY: gift.imagePositionY || 0, category: gift.category && gift.category.name ? { id: String(gift.category._id), name: gift.category.name, slug: gift.category.slug, sortOrder: gift.category.sortOrder || 0 } : null });

export async function giftsForRecipient(userId) {
  const preference = userId ? await GiftPreference.findOne({ user: userId }).select("enabledGifts").lean() : null;
  const activeCategories = await GiftCategory.find({ isActive: true }).distinct("_id");
  const filter = { isActive: true, $or: [{ category: null }, { category: { $in: activeCategories } }] };
  if (preference) filter._id = { $in: preference.enabledGifts || [] };
  return Gift.find(filter).populate({ path: "category", match: { isActive: true } }).sort({ sortOrder: 1, createdAt: 1 }).lean();
}

export async function giftAllowedForRecipient(userId, giftId, session = null) {
  const preference = await GiftPreference.findOne({ user: userId }).select("enabledGifts").session(session);
  return !preference || preference.enabledGifts.some((id) => String(id) === String(giftId));
}
