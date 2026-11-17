import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";

export async function getWallView(userId) {
  const user = await User.findById(userId).select("wallViewPreference").lean();
  if (!user) throw new ApiError(404, "Account not found");
  return user.wallViewPreference || "feed";
}
export async function setWallView(userId, view) {
  if (!["feed", "grid"].includes(view)) throw new ApiError(400, "Unsupported Wall view");
  const user = await User.findByIdAndUpdate(userId, { $set: { wallViewPreference: view } }, { new: true }).select("wallViewPreference").lean();
  if (!user) throw new ApiError(404, "Account not found");
  return user.wallViewPreference;
}
