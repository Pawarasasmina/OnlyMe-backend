export const CREATOR_PROFILE_CATEGORIES = ["Digital creator", "Coach", "Traveler", "Artist", "Musician", "Athlete", "Chef", "Educator"];
export const BUSINESS_PROFILE_CATEGORIES = ["Shop", "Café & restaurant", "Studio & salon", "Fitness club", "Hotel & travel", "Media & news", "Services", "Brand"];
export const PROFILE_ACCOUNT_TYPES = ["personal", "creator", "business"];
export function profileAccountType(user) {
  return user.profileAccountType || (user.creatorApprovalStatus === "approved" ? "creator" : "personal");
}
export function profileCategory(user, roleProfile = {}) {
  const type = profileAccountType(user);
  if (type === "personal") return "";
  return user.profileCategory || (type === "creator" ? roleProfile.profileCategory || "Digital creator" : "Shop");
}
