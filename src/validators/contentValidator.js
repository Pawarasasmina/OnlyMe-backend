import ApiError from "../utils/ApiError.js";

export function validateContentPayload(payload) {
  if (!payload?.title) {
    throw new ApiError(400, "Content title is required");
  }
}
