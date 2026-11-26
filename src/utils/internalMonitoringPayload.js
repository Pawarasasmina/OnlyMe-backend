import { monitoringRoute } from "./monitoringPrivacy.js";
export const ERROR_TYPES = ["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError", "MongoNetworkError", "MongoServerSelectionError", "MongooseServerSelectionError", "HttpError", "UnhandledRejection"];
export function errorFrames(error) {
  return String(error?.stack || "").split("\n").slice(1, 9).flatMap((line) => {
    const match = line.match(/([A-Za-z0-9_.-]+\.(?:jsx?|tsx?|bundle)):(\d+)(?::(\d+))?/);
    return match ? [`${match[1]}:${match[2]}:${match[3] || 0}`] : [];
  });
}
export function sanitizeClientEvent(input) {
  if (!input || !["web", "ios", "android"].includes(input.surface) || !["error", "request", "screen"].includes(input.kind) || !/^[a-zA-Z0-9-]{8,80}$/.test(input.eventId || "")) return null;
  const frames = Array.isArray(input.frames) ? input.frames.filter((frame) => typeof frame === "string" && /^[a-zA-Z0-9_.-]+\.(jsx?|tsx?|bundle):\d+:\d+$/.test(frame)).slice(0, 8) : [];
  return { eventId: input.eventId, source: "client", surface: input.surface, kind: input.kind, route: monitoringRoute(String(input.route || "/")).slice(0, 300), errorType: ERROR_TYPES.includes(input.errorType) ? input.errorType : "Error", frames, status: Number.isInteger(input.status) && input.status >= 0 && input.status <= 599 ? input.status : 0, durationMs: Math.min(120000, Math.max(0, Number(input.durationMs) || 0)), timedOut: input.timedOut === true, release: String(input.release || "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80) };
}
export const DURATION_BOUNDS = [100, 250, 500, 1000, 2000, 3000, 5000, 7000, 10000, 15000, 30000, 60000, 120000];
export function percentileUpperBound(buckets, fraction) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (!total) return null;
  let count = 0;
  for (const bucket of [...buckets].sort((a, b) => a.upper - b.upper)) { count += bucket.count; if (count >= Math.ceil(total * fraction)) return bucket.upper; }
  return null;
}
export function reportingPeriodEnd(now = new Date()) {
  const end = new Date(now); end.setUTCDate(end.getUTCDate() - (end.getUTCDay() + 6) % 7); end.setUTCHours(3, 30, 0, 0);
  if (end > now) end.setUTCDate(end.getUTCDate() - 7);
  return end;
}
