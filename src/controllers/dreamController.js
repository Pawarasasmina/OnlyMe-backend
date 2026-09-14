import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { activeDreamGifts, changeDreamStatus, publicDream, saveDream, sendDreamGift } from "../services/dreamService.js";
import Dream from "../models/Dream.js";
import ApiError from "../utils/ApiError.js";
import { deleteAsset, storeFile } from "../services/storageService.js";

export const getDream = asyncHandler(async (req, res) => { const dream = await publicDream(req.params.username); return sendResponse(res, 200, "Dream fetched", { dream, gifts: await activeDreamGifts(dream?.creator?.id) }); });
export const upsertMine = asyncHandler(async (req, res) => sendResponse(res, 200, "Dream saved", { dream: await saveDream(req.user._id, req.body) }));
export const completeMine = asyncHandler(async (req, res) => sendResponse(res, 200, "Dream completed", { dream: await changeDreamStatus(req.user._id, req.params.id, "COMPLETED", req.body.version) }));
export const removeMine = asyncHandler(async (req, res) => sendResponse(res, 200, "Dream removed", { dream: await changeDreamStatus(req.user._id, req.params.id, "REMOVED", req.body.version) }));
export const giftDream = asyncHandler(async (req, res) => sendResponse(res, 201, "Dream gift sent", await sendDreamGift({ user: req.user, dreamId: req.params.id, giftKey: req.body.giftKey, privateSupport: req.body.privateSupport, key: req.body.idempotencyKey })));
export const uploadMinePhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "Choose a Dream photo");
  const dream = await Dream.findOne({ _id: req.params.id, creator: req.user._id, status: "ACTIVE" });
  if (!dream) throw new ApiError(404, "Active Dream not found");
  const previous = dream.photo?.assetId ? (dream.photo.toObject?.() || dream.photo) : null;
  const stored = await storeFile(req.file, { folder: `onlyme/dreams/${req.user._id}`, resourceType: "image" });
  dream.photo = { assetId: stored.id, url: stored.url, resourceType: stored.resourceType || "image" };
  await dream.save();
  if (previous?.assetId) await deleteAsset(previous.assetId, previous.resourceType || "image").catch(() => {});
  return sendResponse(res, 200, "Dream photo saved", { photo: { url: dream.photo.url } });
});
export const removeMinePhoto = asyncHandler(async (req, res) => {
  const dream = await Dream.findOne({ _id: req.params.id, creator: req.user._id, status: "ACTIVE" });
  if (!dream) throw new ApiError(404, "Active Dream not found");
  const previous = dream.photo?.assetId ? (dream.photo.toObject?.() || dream.photo) : null;
  dream.photo = undefined;
  await dream.save();
  if (previous?.assetId) await deleteAsset(previous.assetId, previous.resourceType || "image").catch(() => {});
  return sendResponse(res, 200, "Dream photo removed", { photo: null });
});
