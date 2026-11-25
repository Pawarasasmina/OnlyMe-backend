import crypto from "node:crypto";
import { env } from "../config/env.js";
import { SAFE_WALL_AREAS, containsPreciseLocation } from "../utils/wallMeetupSafety.js";
import ApiError from "../utils/ApiError.js";

const knownAreas = new Map(SAFE_WALL_AREAS.map(label => [label.toLowerCase(), label]));
export function signWallArea(label, countryCode = "") {
  const data = Buffer.from(JSON.stringify({ label, countryCode, expires: Date.now() + 86400000 })).toString("base64url");
  return `${data}.${crypto.createHmac("sha256", env.accessSecret).update(data).digest("base64url")}`;
}
export function readWallArea(location, token, countryCode = "") {
  const value = String(location || "").trim();
  if (!value) return "";
  if (token) {
    const [data, signature] = String(token).split(".");
    const expected = crypto.createHmac("sha256", env.accessSecret).update(data || "").digest("base64url");
    if (!/^[A-Za-z0-9_-]{43}$/.test(signature || "") || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ApiError(400, "Choose a city or area again", "WALL_AREA_REQUIRED");
    let parsed; try { parsed = JSON.parse(Buffer.from(data, "base64url").toString()); } catch { throw new ApiError(400, "Choose a city or area again", "WALL_AREA_REQUIRED"); }
    if (parsed.expires < Date.now() || parsed.label !== value || containsPreciseLocation(parsed.label)) throw new ApiError(400, "Choose a city or area again", "WALL_AREA_REQUIRED");
    return parsed.label;
  }
  if (knownAreas.has(value.toLowerCase())) return knownAreas.get(value.toLowerCase());
  // Old clients and legacy notes without a signed area can show only a country.
  if (/^[A-Z]{2}$/.test(countryCode)) {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode);
    if (name && name !== countryCode) return name;
  }
  return "";
}
export function assertWallLocationSafety(note) {
  const text = [note.text, note.voiceTranscript, ...(note.media || []).map(item => item.transcript)].filter(Boolean).join(" ");
  if (containsPreciseLocation(text) || containsPreciseLocation(note.location)) throw new ApiError(400, "Keep private addresses, door numbers and exact/live locations out of public Wall notes. Choose a city or area instead.", "WALL_PRIVATE_LOCATION");
}
