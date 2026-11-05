import ApiError from "../utils/ApiError.js";
import { PROFILE_ACCOUNT_TYPES, CREATOR_PROFILE_CATEGORIES, BUSINESS_PROFILE_CATEGORIES, profileAccountType } from "../constants/profileCategoryConstants.js";
export function validateProfileAccountType(user, payload) {
  const type = payload.profileAccountType;
  if (!PROFILE_ACCOUNT_TYPES.includes(type)) throw new ApiError(400, "Choose Personal, Creator, or Business");
  if (type !== profileAccountType(user) && payload.confirmSwitch !== true) throw new ApiError(400, "Confirm the account type change");
  const categories = type === "business" ? BUSINESS_PROFILE_CATEGORIES : CREATOR_PROFILE_CATEGORIES;
  if (type !== "personal" && !categories.includes(payload.profileCategory)) throw new ApiError(400, "Choose a category for this account type");
  const updates = { profileAccountType: type, ...(type !== "personal" ? { profileCategory: payload.profileCategory } : {}) };
  if (type === "business" && Object.hasOwn(payload, "businessContactButtons")) {
    const buttons = payload.businessContactButtons;
    if (!Array.isArray(buttons) || buttons.length > 3 || buttons.some(button => !["call", "directions", "website"].includes(button)) || new Set(buttons).size !== buttons.length) throw new ApiError(400, "Choose up to three valid contact buttons");
    updates.businessContactButtons = buttons;
    updates.businessContactButtonsConfigured = true;
  }
  return updates;
}
