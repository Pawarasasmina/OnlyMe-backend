import LaraSdk from "@translated/lara";
import { env } from "../config/env.js";
import {
  LARA_SUPPORTED_TRANSLATION_LANGUAGES,
  VOICE_TRANSLATION_MAX_TEXT_LENGTH,
  normalizeVoiceLanguageCode,
  resolveSupportedVoiceLanguage,
} from "../constants/voiceTranslationLanguages.js";
import ApiError from "../utils/ApiError.js";

const { Credentials, LaraApiError, TimeoutError, Translator } = LaraSdk;
const LANGUAGE_CACHE_TTL_MS = 5 * 60 * 1000;
let languageCache = { expiresAt: 0, languages: [] };

function cleanText(value) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, VOICE_TRANSLATION_MAX_TEXT_LENGTH);
}

function ensureConfigured() {
  if (!env.laraAccessKeyId || !env.laraAccessKeySecret) {
    throw new ApiError(503, "Translation is currently unavailable.", "TRANSLATION_NOT_CONFIGURED");
  }
}

function createTranslator() {
  ensureConfigured();
  const credentials = new Credentials(env.laraAccessKeyId, env.laraAccessKeySecret);
  return new Translator(credentials, { connectionTimeoutMs: env.laraTranslationTimeoutMs });
}

function isTimeoutError(error) {
  return error instanceof TimeoutError || error?.name === "TimeoutError" || error?.type === "TimeoutError";
}

function isLaraApiError(error) {
  return error instanceof LaraApiError || Number.isFinite(Number(error?.statusCode));
}

function normalizeProviderError(error) {
  if (error instanceof ApiError) return error;
  if (isTimeoutError(error)) {
    return new ApiError(504, "Translation service timed out.", "TRANSLATION_TIMEOUT");
  }
  if (isLaraApiError(error)) {
    const statusCode = Number(error.statusCode) || 502;
    if ([400, 404, 422].includes(statusCode)) {
      return new ApiError(400, "Unsupported translation language.", "UNSUPPORTED_LANGUAGE");
    }
    if (statusCode === 429) {
      return new ApiError(429, "Translation service is busy. Please try again shortly.", "TRANSLATION_FAILED");
    }
    return new ApiError(502, "Could not translate the transcript.", "TRANSLATION_FAILED");
  }
  return new ApiError(502, "Could not translate the transcript.", "TRANSLATION_FAILED");
}

function withTimeout(promise, timeoutMs = env.laraTranslationTimeoutMs) {
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function uniqueKnownLanguages(codes = []) {
  const knownByCode = new Map(LARA_SUPPORTED_TRANSLATION_LANGUAGES.map((language) => [language.code, language]));
  const known = codes
    .map((code) => normalizeVoiceLanguageCode(code))
    .map((code) => knownByCode.get(code) || (code ? { code, name: code } : null))
    .filter(Boolean);

  return known
    .filter((language, index, all) => all.findIndex((item) => item.code === language.code) === index)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function clearTranslationLanguageCache() {
  languageCache = { expiresAt: 0, languages: [] };
}

export function translationAvailable() {
  return Boolean(env.laraAccessKeyId && env.laraAccessKeySecret);
}

export async function listSupportedTranslationLanguages({ translator = null } = {}) {
  const now = Date.now();
  if (!translator && languageCache.expiresAt > now && languageCache.languages.length) {
    return languageCache.languages;
  }

  if (!translator && !translationAvailable()) {
    return LARA_SUPPORTED_TRANSLATION_LANGUAGES;
  }

  try {
    const codes = await withTimeout((translator || createTranslator()).getLanguages());
    const languages = uniqueKnownLanguages(Array.isArray(codes) ? codes : []);
    if (!languages.length) {
      throw new ApiError(502, "Translation languages are unavailable.", "TRANSLATION_FAILED");
    }
    if (!translator) languageCache = { expiresAt: now + LANGUAGE_CACHE_TTL_MS, languages };
    return languages;
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export function normalizeLaraTranslateResponse(response = {}, sourceLanguage = "") {
  const translatedText = cleanText(response.translation);
  if (!translatedText) {
    throw new ApiError(502, "Could not translate the transcript.", "TRANSLATION_FAILED");
  }

  const detectedLanguage = normalizeVoiceLanguageCode(response.sourceLanguage || sourceLanguage);

  return {
    detectedLanguage,
    provider: "lara",
    translatedText,
  };
}

export async function translateVoiceTranscript({
  sourceLanguage = "auto",
  targetLanguage,
  text,
  translator = null,
} = {}) {
  const rawText = String(text || "").trim().replace(/\r\n/g, "\n");
  const clean = cleanText(text);
  const sourceInput = normalizeVoiceLanguageCode(sourceLanguage);
  const target = resolveSupportedVoiceLanguage(targetLanguage);

  if (!clean) {
    throw new ApiError(400, "Transcript text is required.", "TEXT_REQUIRED");
  }

  if (rawText.length > VOICE_TRANSLATION_MAX_TEXT_LENGTH) {
    throw new ApiError(400, "Transcript is too long to translate.", "TEXT_TOO_LONG");
  }

  if (!normalizeVoiceLanguageCode(targetLanguage)) {
    throw new ApiError(400, "Target language is required.", "TARGET_LANGUAGE_REQUIRED");
  }

  if (!target) {
    throw new ApiError(400, "Unsupported translation language.", "UNSUPPORTED_LANGUAGE");
  }

  const source = sourceInput && sourceInput !== "auto" ? resolveSupportedVoiceLanguage(sourceInput) : null;
  if (sourceInput && sourceInput !== "auto" && !source) {
    throw new ApiError(400, "Unsupported translation language.", "UNSUPPORTED_LANGUAGE");
  }

  if (!translator) ensureConfigured();

  if (source?.code === target.code) {
    return {
      detectedLanguage: source.code,
      provider: "lara",
      sameLanguage: true,
      translatedText: clean,
    };
  }

  try {
    const response = await withTimeout(
      (translator || createTranslator()).translate(
        clean,
        source?.code || null,
        target.code,
        {
          contentType: "text/plain",
          multiline: true,
          noTrace: true,
          timeoutInMillis: env.laraTranslationTimeoutMs,
        }
      )
    );

    return normalizeLaraTranslateResponse(response, source?.code || "");
  } catch (error) {
    throw normalizeProviderError(error);
  }
}
