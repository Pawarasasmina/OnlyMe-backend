export const WALL_DAY_MS = 86400000;
export function normalizeWallText(value = "") {
  return String(value).normalize("NFKC").toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
export function wallLinks(value = "") {
  return String(value).normalize("NFKC").match(/(?:https?:\/\/|www\.)[^\s]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:[/?#][^\s]*)?/gi) || [];
}
export function hasWallContacts(value = "") {
  const text = String(value).normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (/(?:whats\s*app|telegram|viber|\bsignal\b|snapchat|\bsnap\b|wechat|discord|messenger|wa\s*\.\s*me|t\s*\.\s*me|signal\s*\.\s*me|m\s*\.\s*me|line\s*\.\s*me|واتساب|تلغرام|телеграм|ватсап|вотсап)/iu.test(text)) return true;
  const phones = text.match(/\+?\p{Nd}[\p{Nd}\s().-]{5,}\p{Nd}/gu) || [];
  return phones.some(phone => (phone.match(/\p{Nd}/gu) || []).length >= 8);
}
export function wallAccountPolicy(user = {}, now = Date.now()) {
  const joined = new Date(user.createdAt).getTime();
  const isNew = Number.isFinite(joined) && Number(now) - joined < 7 * WALL_DAY_MS;
  return { isNew, dailyLimit: isNew ? 2 : 5, isBusiness: user.profileType === "business" || user.role === "business" };
}
export function wallCopySimilarity(left, right) {
  const a = normalizeWallText(left), b = normalizeWallText(right);
  if (a.length < 25 || b.length < 25) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 60) return 0;
  const shingles = text => { const words = text.split(" "); return new Set(words.slice(0, -2).map((word, index) => `${word} ${words[index + 1]} ${words[index + 2]}`)); };
  const aa = shingles(a), bb = shingles(b);
  if (Math.min(aa.size, bb.size) < 6) return 0;
  const common = [...aa].filter(value => bb.has(value)).length;
  return common / Math.min(aa.size, bb.size);
}
