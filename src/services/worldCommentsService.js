import ApiError from "../utils/ApiError.js";

export const WORLD_COMMENTS_DISABLED_CODE = "WORLD_COMMENTS_DISABLED";
export const INVALID_COMMENTS_SETTING_CODE = "INVALID_WORLD_COMMENTS_SETTING";

export function commentsEnabledForPublication(publication = {}) {
  return publication.commentsEnabled !== false;
}

export function readCommentsEnabledSetting(body = {}) {
  if (!Object.hasOwn(body, "commentsEnabled")) return undefined;
  if (typeof body.commentsEnabled !== "boolean") {
    throw new ApiError(400, "commentsEnabled must be a Boolean", INVALID_COMMENTS_SETTING_CODE);
  }
  return body.commentsEnabled;
}

export function assertWorldCommentsEnabled(publication = {}) {
  if (!commentsEnabledForPublication(publication)) {
    throw new ApiError(403, "Comments are turned off for this World.", WORLD_COMMENTS_DISABLED_CODE);
  }
}
