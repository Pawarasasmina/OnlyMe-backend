import mongoose from "mongoose";
import Gift from "../models/Gift.js";
import GiftCategory from "../models/GiftCategory.js";
import DreamGift from "../models/DreamGift.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { deleteGiftImage, uploadGiftImage } from "../services/giftImageStorageService.js";

const serializeCategory = (category) => category ? ({ id: category._id, name: category.name, slug: category.slug, sortOrder: category.sortOrder, isActive: category.isActive }) : null;
const serialize = (gift) => ({ id: gift._id, name: gift.name, stars: gift.stars, imageUrl: gift.image.url, image: gift.image, isAnimated: Boolean(gift.image?.isAnimated), displayScale: gift.displayScale, imagePositionX: gift.imagePositionX || 0, imagePositionY: gift.imagePositionY || 0, category: serializeCategory(gift.category), sortOrder: gift.sortOrder, isActive: gift.isActive, createdAt: gift.createdAt, updatedAt: gift.updatedAt });
const integer = (value, label, min, max) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < min || result > max) throw new ApiError(400, `${label} must be a whole number from ${min} to ${max}`); return result; };
const nameValue = (value) => { const name = String(value || "").trim(); if (!name || name.length > 80) throw new ApiError(400, "Gift name is required and must be at most 80 characters"); return name; };

export const listGifts = asyncHandler(async (_req, res) => {
  const [gifts, categories] = await Promise.all([Gift.find().populate("category").sort({ sortOrder: 1, createdAt: 1 }).lean(), GiftCategory.find().sort({ sortOrder: 1, name: 1 }).lean()]);
  return sendResponse(res, 200, "Gift catalog fetched", { gifts: gifts.map(serialize), categories: categories.map(serializeCategory) });
});

const categoryValue = async (value) => {
  if (!value) return null;
  if (!mongoose.isValidObjectId(value) || !await GiftCategory.exists({ _id: value })) throw new ApiError(400, "Choose a valid gift category");
  return value;
};

export const createGift = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "Choose a PNG, animated WebP, GIF, or JPEG gift image");
  const image = await uploadGiftImage(req.file, req.user._id);
  try {
    const lastGift = await Gift.findOne().sort({ sortOrder: -1 }).select("sortOrder").lean();
    const gift = await Gift.create({ name: nameValue(req.body.name), stars: integer(req.body.stars, "Star value", 1, 1000000), category: await categoryValue(req.body.categoryId), displayScale: integer(req.body.displayScale || 100, "Display scale", 40, 140), imagePositionX: integer(req.body.imagePositionX || 0, "Horizontal position", -50, 50), imagePositionY: integer(req.body.imagePositionY || 0, "Vertical position", -50, 50), sortOrder: Math.min((lastGift?.sortOrder || 0) + 1, 100000), isActive: String(req.body.isActive) !== "false", image, createdBy: req.user._id, updatedBy: req.user._id });
    return sendResponse(res, 201, "Gift created", { gift: serialize(gift) });
  } catch (error) { await deleteGiftImage(image.assetId).catch(() => {}); throw error; }
});

export const updateGift = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid gift ID");
  const gift = await Gift.findById(req.params.id);
  if (!gift) throw new ApiError(404, "Gift not found");
  const previousAssetId = gift.image.assetId;
  let uploaded;
  if (req.file) uploaded = await uploadGiftImage(req.file, req.user._id);
  try {
    if (req.body.name !== undefined) gift.name = nameValue(req.body.name);
    if (req.body.stars !== undefined) gift.stars = integer(req.body.stars, "Star value", 1, 1000000);
    if (req.body.categoryId !== undefined) gift.category = await categoryValue(req.body.categoryId);
    if (req.body.displayScale !== undefined) gift.displayScale = integer(req.body.displayScale, "Display scale", 40, 140);
    if (req.body.imagePositionX !== undefined) gift.imagePositionX = integer(req.body.imagePositionX, "Horizontal position", -50, 50);
    if (req.body.imagePositionY !== undefined) gift.imagePositionY = integer(req.body.imagePositionY, "Vertical position", -50, 50);
    if (req.body.sortOrder !== undefined) gift.sortOrder = integer(req.body.sortOrder, "Sort order", 0, 100000);
    if (req.body.isActive !== undefined) gift.isActive = String(req.body.isActive) === "true";
    if (uploaded) gift.image = uploaded;
    gift.updatedBy = req.user._id;
    await gift.save();
  } catch (error) { if (uploaded) await deleteGiftImage(uploaded.assetId).catch(() => {}); throw error; }
  if (uploaded) await deleteGiftImage(previousAssetId).catch(() => {});
  return sendResponse(res, 200, "Gift updated", { gift: serialize(gift) });
});

const categoryName = (value) => { const name = String(value || "").trim(); if (!name || name.length > 60) throw new ApiError(400, "Category name is required and must be at most 60 characters"); return name; };
const categorySlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || `category-${Date.now()}`;

export const createGiftCategory = asyncHandler(async (req, res) => {
  const name = categoryName(req.body.name);
  const last = await GiftCategory.findOne().sort({ sortOrder: -1 }).select("sortOrder").lean();
  try {
    const category = await GiftCategory.create({ name, slug: categorySlug(name), sortOrder: (last?.sortOrder || 0) + 1, createdBy: req.user._id, updatedBy: req.user._id });
    return sendResponse(res, 201, "Gift category created", { category: serializeCategory(category) });
  } catch (error) { if (error?.code === 11000) throw new ApiError(409, "A category with this name already exists"); throw error; }
});

export const updateGiftCategory = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid category ID");
  const category = await GiftCategory.findById(req.params.id);
  if (!category) throw new ApiError(404, "Gift category not found");
  if (req.body.name !== undefined) { category.name = categoryName(req.body.name); category.slug = categorySlug(category.name); }
  if (req.body.isActive !== undefined) category.isActive = Boolean(req.body.isActive);
  category.updatedBy = req.user._id;
  try { await category.save(); } catch (error) { if (error?.code === 11000) throw new ApiError(409, "A category with this name already exists"); throw error; }
  return sendResponse(res, 200, "Gift category updated", { category: serializeCategory(category) });
});

export const deleteGiftCategory = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid category ID");
  if (await Gift.exists({ category: req.params.id })) throw new ApiError(409, "Move gifts out of this category before deleting it");
  const category = await GiftCategory.findByIdAndDelete(req.params.id);
  if (!category) throw new ApiError(404, "Gift category not found");
  return sendResponse(res, 200, "Gift category deleted", { id: category._id });
});

export const deleteGift = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid gift ID");
  const gift = await Gift.findById(req.params.id);
  if (!gift) throw new ApiError(404, "Gift not found");
  if (await DreamGift.exists({ gift: gift._id })) throw new ApiError(409, "This gift has transaction history. Deactivate it instead of deleting it.");
  await gift.deleteOne();
  await deleteGiftImage(gift.image.assetId).catch(() => {});
  return sendResponse(res, 200, "Gift deleted", { id: gift._id });
});

export const reorderGifts = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) throw new ApiError(400, "Provide a valid ordered gift list");
  const existing = await Gift.find({ _id: { $in: ids } }).select("_id").lean();
  if (existing.length !== ids.length || await Gift.countDocuments() !== ids.length) throw new ApiError(409, "Gift catalog changed. Refresh and arrange it again.");
  await Gift.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { sortOrder: index + 1, updatedBy: req.user._id } } } })));
  const gifts = await Gift.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
  return sendResponse(res, 200, "Gift order updated", { gifts: gifts.map(serialize) });
});
