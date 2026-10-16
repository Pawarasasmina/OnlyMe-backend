import { createHash } from "node:crypto";
import ApiError from "../utils/ApiError.js";
import { detectTextLanguage, translateVoiceTranscript } from "./translationService.js";
import { getVoiceLanguageName, resolveSupportedVoiceLanguage } from "../constants/voiceTranslationLanguages.js";

const detected = new Map();
const translated = new Map();
const TTL = 10 * 60 * 1000;
const digest = (text) => createHash("sha256").update(text).digest("hex");
const baseLanguage = (code) => String(code || "").split("-")[0].toLowerCase();
async function cached(map, key, create) {
  const existing = map.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const entry = { expiresAt: Date.now() + TTL, value: Promise.resolve().then(create) };
  map.set(key, entry);
  if (map.size > 500) map.delete(map.keys().next().value);
  try { return await entry.value; }
  catch (error) { if (map.get(key) === entry) map.delete(key); throw error; }
}
export function clearWallTranslationCache() { detected.clear(); translated.clear(); }

export async function wallTranslationMetadata({ text, preferredLanguage = "en", detect = detectTextLanguage }) {
  const original = String(text || "").trim();
  if (original.length > 2000) throw new ApiError(400, "Post text is too long to translate");
  const target = resolveSupportedVoiceLanguage(preferredLanguage) || resolveSupportedVoiceLanguage("en");
  const sourceLanguage = original ? await cached(detected, digest(original), () => detect(original)) : "";
  return {
    sourceLanguage,
    sourceLanguageName: getVoiceLanguageName(sourceLanguage),
    targetLanguage: target.code,
    targetLanguageName: target.name,
    canTranslate: Boolean(sourceLanguage && baseLanguage(sourceLanguage) !== baseLanguage(target.code)),
  };
}

export async function translateWallContent({ text, preferredLanguage, detect, translate = translateVoiceTranscript }) {
  const original = String(text || "").trim();
  const metadata = await wallTranslationMetadata({ text: original, preferredLanguage, detect });
  if (!metadata.sourceLanguage) throw new ApiError(503, "Could not detect the original language. Please try again.", "LANGUAGE_DETECTION_UNAVAILABLE");
  if (!metadata.canTranslate) return { ...metadata, translatedText: original, sameLanguage: true };
  const result = await cached(translated, `${digest(original)}:${metadata.sourceLanguage}:${metadata.targetLanguage}`, () => translate({ text: original, sourceLanguage: metadata.sourceLanguage, targetLanguage: metadata.targetLanguage }));
  return { ...metadata, translatedText: result.translatedText, sameLanguage: false };
}
