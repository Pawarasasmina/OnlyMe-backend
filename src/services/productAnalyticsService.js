import AnalyticsEvent from "../models/AnalyticsEvent.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";

export const PRODUCT_TIMEZONE = "Asia/Dubai";
export const PRODUCT_EVENTS = Object.freeze({ world_open: "WORLD_OPEN", chapter_complete: "CHAPTER_COMPLETE", scroll_skip: "FAST_SKIP", save: "SAVE" });
export const SUPPORT_ENTRY_TYPES = Object.freeze(["DREAM_GIFT_DEBIT", "CHAT_GIFT_DEBIT"]);

export function productEventMatch(startDate, endDate, accountType = "NON_TEST") {
  return { createdAt: { $gte: startDate, $lte: endDate }, actorAccountType: accountType === "TEST" ? "TEST" : { $ne: "TEST" }, eventType: { $in: Object.values(PRODUCT_EVENTS) } };
}

export function supportMatch(startDate, endDate, accountType = "NON_TEST") {
  // Committed debit entries survive payment retries and analytics outages.
  // Do not count top-ups, payout movements, membership sales or creator credits.
  return { createdAt: { $gte: startDate, $lte: endDate }, financialMode: accountType === "TEST" ? "TEST" : { $ne: "TEST" }, direction: "DEBIT", entryType: { $in: SUPPORT_ENTRY_TYPES } };
}

const day = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: PRODUCT_TIMEZONE } };

export function summarizeProductEvents(rows, supportRows) {
  const totals = { world_open: 0, chapter_complete: 0, scroll_skip: 0, support: 0, save: 0 };
  const reverse = Object.fromEntries(Object.entries(PRODUCT_EVENTS).map(([key, type]) => [type, key]));
  const dates = new Map();
  const bucket = date => {
    if (!dates.has(date)) dates.set(date, { label: date, world_open: 0, chapter_complete: 0, scroll_skip: 0, support: 0, save: 0, supportCoins: 0 });
    return dates.get(date);
  };
  for (const row of rows) {
    const key = reverse[row._id.eventType];
    if (!key) continue;
    totals[key] += row.count;
    bucket(row._id.day)[key] += row.count;
  }
  let supportCoins = 0;
  for (const row of supportRows) {
    totals.support += row.count;
    supportCoins += row.coins;
    bucket(row._id).support += row.count;
    bucket(row._id).supportCoins += row.coins;
  }
  return { timezone: PRODUCT_TIMEZONE, totals, supportCoins, trend: [...dates.values()].sort((a, b) => a.label.localeCompare(b.label)) };
}

export async function getProductAnalytics(startDate, endDate, accountType = "NON_TEST") {
  const [events, support] = await Promise.all([
    AnalyticsEvent.aggregate([{ $match: productEventMatch(startDate, endDate, accountType) }, { $group: { _id: { day, eventType: "$eventType" }, count: { $sum: 1 } } }]),
    StarsLedgerEntry.aggregate([{ $match: supportMatch(startDate, endDate, accountType) }, { $group: { _id: day, count: { $sum: 1 }, coins: { $sum: "$starsAmount" } } }]),
  ]);
  return { ...summarizeProductEvents(events, support), accountType: accountType === "TEST" ? "TEST" : "NON_TEST" };
}

export async function getProductPeakUsage(startDate, endDate, accountType = "NON_TEST") {
  const grouping = { $group: { _id: { hour: { $hour: { date: "$createdAt", timezone: PRODUCT_TIMEZONE } }, day: { $dayOfWeek: { date: "$createdAt", timezone: PRODUCT_TIMEZONE } } }, count: { $sum: 1 } } };
  const [events, support] = await Promise.all([
    AnalyticsEvent.aggregate([{ $match: productEventMatch(startDate, endDate, accountType) }, grouping]),
    StarsLedgerEntry.aggregate([{ $match: supportMatch(startDate, endDate, accountType) }, grouping]),
  ]);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, count: 0 }));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(label => ({ label, count: 0 }));
  for (const row of [...events, ...support]) {
    hours[row._id.hour].count += row.count;
    days[row._id.day - 1].count += row.count;
  }
  return { timezone: PRODUCT_TIMEZONE, hours, days, basis: "product_events" };
}
