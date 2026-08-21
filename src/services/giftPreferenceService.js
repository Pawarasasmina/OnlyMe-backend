import Gift from "../models/Gift.js";
import GiftPreference from "../models/GiftPreference.js";

export const serializeGift = (gift) => ({ id: String(gift._id), key: String(gift._id), name: gift.name, stars: gift.stars, imageUrl: gift.image.url, displayScale: gift.displayScale || 100, imagePositionX: gift.imagePositionX || 0, imagePositionY: gift.imagePositionY || 0 });

export async function giftsForRecipient(userId) {
  const preference = userId ? await GiftPreference.findOne({ user: userId }).select("enabledGifts").lean() : null;
  const filter = { isActive: true };
  if (preference) filter._id = { $in: preference.enabledGifts || [] };
  return Gift.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean();
}

export async function giftAllowedForRecipient(userId, giftId, session = null) {
  const preference = await GiftPreference.findOne({ user: userId }).select("enabledGifts").session(session);
  return !preference || preference.enabledGifts.some((id) => String(id) === String(giftId));
}
