import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { normalizeWallNeedHintIds, WALL_NEED_HINT_IDS } from "../constants/wallNeedHintConstants.js";

const seenIds = values => normalizeWallNeedHintIds(values);

export async function getWallHintDismissals(userId) {
  const user = await User.findById(userId).select("wallHintDismissals").lean();
  if (!user) throw new ApiError(404, "Account not found");
  return seenIds(user.wallHintDismissals);
}

export async function dismissWallHint(userId, hintId) {
  if (!WALL_NEED_HINT_IDS.includes(hintId)) throw new ApiError(400, "Unsupported Wall hint");
  const user = await User.findByIdAndUpdate(userId, { $addToSet: { wallHintDismissals: hintId } }, { new: true }).select("wallHintDismissals").lean();
  if (!user) throw new ApiError(404, "Account not found");
  return seenIds(user.wallHintDismissals);
}
