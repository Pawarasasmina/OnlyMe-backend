import ApiError from "../utils/ApiError.js";

export function validateContentPayload(payload) {
  const topic = payload?.topic?.trim();
  const images = payload?.images;

  if (!topic) {
    throw new ApiError(400, "Content topic is required");
  }

  if (topic.length > 120) {
    throw new ApiError(400, "Content topic cannot exceed 120 characters");
  }

  if (!Array.isArray(images) || images.length < 1 || images.length > 10) {
    throw new ApiError(400, "Select between 1 and 10 images");
  }

  if (images.filter((image) => image?.isMain).length !== 1) {
    throw new ApiError(400, "Exactly one main image is required");
  }

  if (images.some((image) => !image?.publicId || !image?.url)) {
    throw new ApiError(400, "Every image must have a public ID and URL");
  }
}
