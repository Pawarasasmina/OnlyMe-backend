export const MEETUP_SAFETY_TIPS = [
  "Meet in a busy public place. Never share your home address or live location in a public note.",
  "Tell someone you trust where you are going and arrange your own transport.",
  "Leave if you feel uncomfortable. Use “I feel unsafe” to send an urgent report.",
];
export const isMeetupNote = note => note?.postType === "Company" || note?.postType === "Right Now" || note?.postType === "Need Help" || note?.rightNow === true || note?.topic === "Meet people" || ["RIGHT_NOW", "NEED_HELP", "Meet people"].includes(note?.context);

// Reject common address, coordinate, live-map and unit/door-number formats.
const precisePatterns = [
  /(?:https?:\/\/)?(?:www\.)?google\.[^\s/]+\/maps\S*/giu,
  /[-+]?\d{1,2}\.\d{3,}\s*[,;/ ]\s*[-+]?\d{1,3}\.\d{3,}/giu,
  /\b(?:lat(?:itude)?|lon(?:gitude)?|lng)\s*[:=]\s*[-+]?\d+(?:\.\d+)?/giu,
  /(?:https?:\/\/)?(?:maps\.app\.goo\.gl|maps\.google\.[^\s/]+|goo\.gl\/maps|maps\.apple\.com|waze\.com|what3words\.com)\S*/giu,
  /https?:\/\/[^\s]*(?:[?&](?:q|query|ll|lat|lon|lng)=|\/@)[^\s]*/giu,
  /\b(?:apartment|apt|flat|unit|suite|room|door|villa|house|building|floor)\s*(?:no\.?|number|#)?\s*[:.-]?\s*\d+[\p{L}\p{N}/-]*/giu,
  /\b\d+[\p{L}]?\s+(?:[\p{L}.'-]+\s+){0,5}(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd\.?|crescent|close|way|شارع|улица|rue|straße|strasse|rua|calle)\b/giu,
  /\b(?:street|road|avenue|lane|rue|straße|strasse|rua|calle|улица)\s+[\p{L} .'-]{1,60}\s+\d+[\p{L}]?\b/giu,
  /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,}\b/giu,
  /\/\/\/[\p{L}]+\.[\p{L}]+\.[\p{L}]+/giu,
];
export function containsPreciseLocation(value) {
  return precisePatterns.some(pattern => { pattern.lastIndex = 0; return pattern.test(String(value || "").normalize("NFKC")); });
}
export function redactPreciseLocation(value) {
  let text = String(value || "").normalize("NFKC");
  for (const pattern of precisePatterns) { pattern.lastIndex = 0; text = text.replace(pattern, "[private location removed]"); }
  return text;
}

export const SAFE_WALL_AREAS = Object.freeze([
  "Dubai, UAE", "Dubai", "Abu Dhabi, UAE", "Abu Dhabi", "Dubai Marina", "Dubai Marina, UAE", "Downtown Dubai, Dubai, UAE", "JBR, Dubai, UAE", "Palm Jumeirah, Dubai, UAE", "Business Bay, Dubai, UAE",
  "Paris, France", "Paris", "London, UK", "London, United Kingdom", "London", "Tokyo, Japan", "Tokyo", "New York, USA", "New York, United States", "New York", "Lisbon, Portugal", "Lisbon", "Colombo, Sri Lanka", "Colombo", "Warsaw, Poland", "Barcelona, Spain", "Singapore",
]);
