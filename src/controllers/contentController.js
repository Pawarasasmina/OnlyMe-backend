import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { createUploadSignature } from "../services/storageService.js";
import Content from "../models/Content.js";
import ApiError from "../utils/ApiError.js";
import { validateContentPayload } from "../validators/contentValidator.js";

export const listContent = asyncHandler(async (req, res) => {
  const filter = { status: "published" };
  if (req.params.creatorId) filter.creator = req.params.creatorId;

  const items = await Content.find(filter).sort({ publishedAt: -1 }).populate(
    "creator",
    "name username avatar"
  );
  return sendResponse(res, 200, "Published content fetched", {
    items,
  });
});

export const listMyContent = asyncHandler(async (req, res) => {
  const items = await Content.find({ creator: req.user._id }).sort({ createdAt: -1 });
  return sendResponse(res, 200, "Creator content fetched", { items });
});

export const getUploadSignature = asyncHandler(async (req, res) => {
  const upload = createUploadSignature(req.user._id.toString());
  return sendResponse(res, 200, "Cloudinary upload signature created", upload);
});

export const publishImageContent = asyncHandler(async (req, res) => {
  validateContentPayload(req.body);

  const expectedFolder = `onlyme/${req.user._id}/`;
  if (req.body.images.some((image) => !image.publicId.startsWith(expectedFolder))) {
    throw new ApiError(400, "One or more images do not belong to this creator");
  }

  const images = req.body.images.map((image) => ({
    publicId: image.publicId,
    url: image.url,
    width: image.width,
    height: image.height,
    format: image.format,
    bytes: image.bytes,
    isMain: Boolean(image.isMain),
  }));

  const content = await Content.create({
    creator: req.user._id,
    title: req.body.topic.trim(),
    topic: req.body.topic.trim(),
    description: req.body.description?.trim() || "",
    contentType: "image",
    images,
    status: "published",
    publishedAt: new Date(),
  });

  return sendResponse(res, 201, "Image content published", { content });
});
