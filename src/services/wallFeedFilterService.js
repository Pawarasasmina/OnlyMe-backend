import { wallActiveExpression } from "./wallLifecycleService.js";
import ApiError from "../utils/ApiError.js";

export const WALL_TYPES = {
  buy_sell: { value: "Buy & Sell", legacy: ["Buy/Sell", "Shopping"] },
  looking_for: { value: "Looking for", legacy: ["Looking for"] },
  offering: { value: "Offering", legacy: ["Buy/Sell", "Shopping"] },
  need_help: { value: "Need Help", legacy: ["Need help"] },
  question: { value: "Question", legacy: ["Advice"] },
  recommendation: { value: "Recommendation", legacy: ["Recommendation"] },
  right_now: { value: "Right Now", legacy: ["Right now"] },
  event: { value: "Event", legacy: ["Events"] },
};
export const WALL_TOPICS = {
  meet_people: { value: "Meet people", legacy: ["Meet people"] },
  housing: { value: "Housing", legacy: ["Housing"] },
  kids_family: { value: "Kids & Family", legacy: ["Kids & Family"] },
  buy_sell: { value: "Buy / Sell", legacy: ["Buy/Sell", "Shopping"] },
  places: { value: "Places", legacy: ["Place"] },
  food: { value: "Food", legacy: ["Coffee", "Restaurant"] },
  travel: { value: "Travel", legacy: ["Travel"] },
  work: { value: "Work", legacy: ["Business"] },
  wellness: { value: "Wellness", legacy: ["Wellness", "Fitness"] },
  learning: { value: "Learning", legacy: ["Book"] },
  lifestyle: { value: "Lifestyle", legacy: ["Lifestyle", "Beauty", "Family"] },
  services: { value: "Services", legacy: [] },
  community: { value: "Community", legacy: ["Community", "Updates"] },
};
const clean = (value, max = 120) => String(value || "").trim().slice(0, max);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const key = (value) => clean(value).toLowerCase().replace(/[\s/-]+/g, "_");

function categoryMatch(field, option) {
  return { $or: [
    { [field]: option.value },
    { $and: [{ $or: [{ [field]: "" }, { [field]: { $exists: false } }] }, { context: { $in: option.legacy } }] },
  ] };
}

export function readWallFeedFilters(query = {}) {
  const type = key(query.type || "all");
  const topic = key(query.topic || "all");
  const scope = key(query.scope || "worldwide");
  const sort = key(query.sort || "recent");
  if (type !== "all" && !Object.hasOwn(WALL_TYPES, type)) throw new ApiError(400, "Unsupported Wall type");
  if (topic !== "all" && !Object.hasOwn(WALL_TOPICS, topic)) throw new ApiError(400, "Unsupported Wall topic");
  if (!["worldwide", "nearby", "city", "country", "custom"].includes(scope)) throw new ApiError(400, "Unsupported Wall location scope");
  if (!["recent", "popular", "nearby"].includes(sort)) throw new ApiError(400, "Unsupported Wall sort");
  const location = clean(query.location || query.city);
  const near = clean(query.near || query.city || (scope !== "country" ? location : ""));
  if (scope !== "worldwide" && !location && !(scope === "nearby" && near)) throw new ApiError(400, "Choose a location for this filter");
  if ((scope === "nearby" || sort === "nearby") && !near) throw new ApiError(400, "Choose a city to use Nearby");
  const and = [];
  if (type !== "all") and.push(type === "right_now" ? { $or: [{ rightNow: true }, categoryMatch("postType", WALL_TYPES[type])] } : categoryMatch("postType", WALL_TYPES[type]));
  if (type === "right_now") and.push({ $expr: wallActiveExpression() });
  if (topic !== "all") and.push(categoryMatch("topic", WALL_TOPICS[topic]));
  const matchLocation = scope === "nearby" ? near : location;
  // A legacy location parameter is still supported even without a scope.
  if (matchLocation) and.push({ location: { $regex: escapeRegex(matchLocation), $options: "i" } });
  const search = clean(query.q, 120);
  if (search) and.push({ text: { $regex: escapeRegex(search), $options: "i" } });
  return { match: and.length ? { $and: and } : {}, sort, near };
}

export function wallFeedPipeline(match, { sort, near }, blockedIds, page, limit) {
  const recent = { "__activity.createdAt": -1, _id: -1, "__activity.shareId": -1 };
  const order = { __solved: 1, ...(sort === "popular" ? { __popularity: -1, ...recent } : sort === "nearby" ? { __nearby: 1, ...recent } : recent) };
  const publicCount = (field, extra = {}) => ({ $size: { $filter: { input: { $ifNull: [`$${field}`, []] }, as: "entry", cond: { $and: [{ $ne: ["$$entry.actorAccountType", "TEST"] }, ...Object.entries(extra).map(([name, value]) => ({ $eq: [{ $ifNull: [`$$entry.${name}`, null] }, value] }))] } } } });
  return [
    { $match: match },
    { $set: {
      __solved: { $cond: [wallActiveExpression(), 0, 1] },
      __popularity: { $add: [publicCount("reactions"), publicCount("comments", { deletedAt: null }), publicCount("shares")] },
      __nearby: { $cond: [{ $regexMatch: { input: { $ifNull: ["$location", ""] }, regex: escapeRegex(near), options: "i" } }, 0, 1] },
      __activities: { $concatArrays: [
        [{ shareId: null, createdAt: { $ifNull: ["$publishedAt", "$createdAt"] }, user: null, caption: "" }],
        { $map: { input: { $filter: { input: { $ifNull: ["$shares", []] }, as: "share", cond: { $not: [{ $in: ["$$share.user", blockedIds] }] } } }, as: "share", in: { shareId: "$$share._id", createdAt: "$$share.createdAt", user: "$$share.user", caption: "$$share.caption" } } },
      ] },
    } },
    { $unwind: "$__activities" },
    { $set: { __activity: "$__activities" } },
    { $lookup: { from: "users", localField: "__activity.user", foreignField: "_id", as: "__sharers" } },
    { $set: { __sharer: { $arrayElemAt: ["$__sharers", 0] } } },
    { $match: { $or: [{ "__activity.shareId": null }, { "__sharer._id": { $exists: true }, "__sharer.status": { $in: ["active", null] } }] } },
    { $project: { _id: 1, __activity: 1, __solved: 1, __popularity: 1, __nearby: 1, "__sharer._id": 1, "__sharer.name": 1, "__sharer.username": 1, "__sharer.avatar": 1, "__sharer.isVerified": 1 } },
    { $sort: order },
    { $facet: {
      items: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: { _id: 1, __activity: 1, "__sharer._id": 1, "__sharer.name": 1, "__sharer.username": 1, "__sharer.avatar": 1, "__sharer.isVerified": 1 } }],
      total: [{ $count: "count" }],
    } },
  ];
}
