import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { WALL_NEED_HINT_IDS } from "../constants/wallNeedHintConstants.js";

const tipKeys = { right_now: "now", meet_people: "Meet people", need_help: "help", looking_for: "look", buy_sell: "sell", recommendation: "rec", more: "more" };
const seenIds = values => WALL_NEED_HINT_IDS.filter(id => (values || []).includes(id) || (values || []).includes(`tip:wk:${tipKeys[id]}`));

export async function getWallHintDismissals(userId) {
  const user = await User.findById(userId).select("wallHintDismissals").lean();
  if (!user) throw new ApiError(404, "Account not found");
  return seenIds(user.wallHintDismissals);
}

export async function dismissWallHint(userId, hintId) {
  if (!WALL_NEED_HINT_IDS.includes(hintId)) throw new ApiError(400, "Unsupported Wall hint");
  const user = await User.findByIdAndUpdate(userId, { $addToSet: { wallHintDismissals: `tip:wk:${tipKeys[hintId]}` } }, { new: true }).select("wallHintDismissals").lean();
  if (!user) throw new ApiError(404, "Account not found");
  return seenIds(user.wallHintDismissals);
}
