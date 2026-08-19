import ApiError from "../utils/ApiError.js";
import { hasCreatorAccess } from "../utils/accountCapabilities.js";
import Publication from "../models/Publication.js";

export function requireApprovedCreator(req, _res, next) {
  if (!hasCreatorAccess(req.user)) {
    next(new ApiError(403, "Your creator application must be approved by an admin"));
    return;
  }

  next();
}

export async function requireApprovedCreatorOrSeenOwner(req, _res, next) {
  if (hasCreatorAccess(req.user)) return next();
  if (req.method === "POST" && req.path.endsWith("/drafts")) {
    return String(req.body?.kind || "").toUpperCase() === "SEEN"
      ? next()
      : next(new ApiError(403, "Creator approval is required to create Worlds"));
  }
  if (req.method === "GET" && req.path.endsWith("/mine")) {
    req.query.kind = "SEEN";
    return next();
  }
  if (req.params?.id) {
    try {
      const seen = await Publication.exists({ _id: req.params.id, creator: req.user._id, kind: "SEEN" });
      if (seen) return next();
    } catch {
      return next(new ApiError(400, "Invalid publication ID"));
    }
  }
  return next(new ApiError(403, "Creator approval is required for Worlds and revenue features"));
}
