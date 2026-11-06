import Notification from "../models/Notification.js";
import Publication from "../models/Publication.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import { purchaseWorld } from "../services/worldPurchaseService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const purchase = asyncHandler(async (req, res) => sendResponse(res, 200, "World purchased", await purchaseWorld({ user: req.user, publicationId: req.params.publicationId, key: req.body.idempotencyKey })));

export const thankSeenCreator = asyncHandler(async (req, res) => {
  const publication = await Publication.findOne({ _id: req.params.publicationId, kind: "SEEN", status: "PUBLISHED" })
    .select("creator title coverMedia")
    .lean();
  if (!publication) return sendResponse(res, 404, "Seen not found");

  const entitlement = await WorldEntitlement.findOne({ user: req.user._id, publication: publication._id, creator: publication.creator, status: "ACTIVE" }).select("_id").lean();
  if (!entitlement) return sendResponse(res, 403, "Unlock this Seen before thanking its creator");

  const dedupeKey = `seen-owner-thanks:${publication._id}:${req.user._id}`;
  const cover = publication.coverMedia?.secureUrl
    ? publication.coverMedia.resourceType === "video" || publication.coverMedia.mediaType === "VIDEO"
      ? { videoUrl: publication.coverMedia.secureUrl }
      : { imageUrl: publication.coverMedia.secureUrl }
    : {};
  const notification = await Notification.findOneAndUpdate(
    { dedupeKey },
    { $setOnInsert: {
      user: publication.creator,
      actor: req.user._id,
      type: "seen_owner_thanks",
      title: `${req.user.name || req.user.username || "A new owner"} thanked you for unlocking “${publication.title || "your Seen"}”`,
      message: "They appreciated your Seen and sent thanks.",
      target: { type: "SEEN", id: publication._id },
      metadata: { publicationId: String(publication._id), publicationTitle: publication.title || "Seen", cover },
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  req.app.get("io")?.to(`user:${publication.creator}`).emit("activity:updated", { type: "seen_owner_thanks", publicationId: String(publication._id) });
  return sendResponse(res, 200, "Thanks sent", { sent: true, activityId: String(notification._id) });
});
