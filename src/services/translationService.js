import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";
import {
  VOICE_TRANSLATION_MAX_TEXT_LENGTH,
  normalizeVoiceLanguageCode,
} from "../../../shared/voiceTranslationLanguages.js";

const LANGUAGE_CACHE_TTL_MS = 5 * 60 * 1000;
let languageCache = { expiresAt: 0, languages: [] };

function cleanText(value) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, VOICE_TRANSLATION_MAX_TEXT_LENGTH);
}

function baseUrl() {
  return String(env.libreTranslateUrl || "").trim().replace(/\/+$/, "");
}

function providerUrl(path) {
  const base = baseUrl();
  if (!base) {
    throw new ApiError(503, "Voice translation is not configured.", "TRANSLATION_NOT_CONFIGURED");
  }
  return `${base}${path}`;
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function isConnectionError(error) {
  return ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(error?.cause?.code || error?.code);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.libreTranslateTimeoutMs);
  const fetchImpl = options.fetchImpl || fetch;
  const fetchOptions = { ...options };
  delete fetchOptions.fetchImpl;

  try {
    const response = await fetchImpl(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      if (response.ok) {
        throw new ApiError(502, "Could not translate the transcript.", "TRANSLATION_FAILED");
      }
    }

    if (!response.ok) {
      if (response.status === 400) throw new ApiError(400, "Unsupported translation language.", "UNSUPPORTED_LANGUAGE");
      if (response.status === 429) throw new ApiError(429, "Translation service is busy. Please try again shortly.", "TRANSLATION_FAILED");
      if (response.status === 403) throw new ApiError(502, "Translation service rejected the request.", "TRANSLATION_FAILED");
      throw new ApiError(502, "Translation service is currently unavailable.", "TRANSLATION_SERVICE_UNAVAILABLE");
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isAbortError(error)) {
      throw new ApiError(504, "Translation service timed out.", "TRANSLATION_TIMEOUT");
    }
    if (isConnectionError(error)) {
      throw new ApiError(503, "Translation service is currently unavailable.", "TRANSLATION_SERVICE_UNAVAILABLE");
    }
    throw new ApiError(502, "Could not translate the transcript.", "TRANSLATION_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLanguage(entry = {}) {
  const code = normalizeVoiceLanguageCode(entry.code || entry.language || entry.target);
  const name = String(entry.name || entry.label || code).trim();
  if (!code || !name) return null;
  return { code, name };
}

export function clearTranslationLanguageCache() {
  languageCache = { expiresAt: 0, languages: [] };
}

export async function listSupportedTranslationLanguages({ fetchImpl = fetch } = {}) {
  const now = Date.now();
  if (languageCache.expiresAt > now && languageCache.languages.length) {
    return languageCache.languages;
  }

  const payload = await fetchJson(providerUrl("/languages"), { method: "GET", fetchImpl });
  const languages = (Array.isArray(payload) ? payload : [])
    .map(normalizeLanguage)
    .filter(Boolean)
    .filter((language, index, all) => all.findIndex((item) => item.code === language.code) === index)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (!languages.length) {
    throw new ApiError(502, "Translation languages are unavailable.", "TRANSLATION_SERVICE_UNAVAILABLE");
  }

  languageCache = { expiresAt: now + LANGUAGE_CACHE_TTL_MS, languages };
  return languages;
}

export function normalizeLibreTranslateResponse(response = {}, sourceLanguage = "auto") {
  const translatedText = cleanText(response.translatedText);
  if (!translatedText) {
    throw new ApiError(502, "Could not translate the transcript.", "TRANSLATION_FAILED");
  }

  const detectedLanguage = normalizeVoiceLanguageCode(
    response.detectedLanguage?.language
      || response.detectedLanguage?.code
      || response.detectedLanguage
      || (sourceLanguage === "auto" ? "" : sourceLanguage)
  );

  return {
    detectedLanguage,
    provider: "libretranslate",
    translatedText,
  };
}

export async function translateVoiceTranscript({
  fetchImpl = fetch,
  sourceLanguage = "auto",
  targetLanguage,
  text,
} = {}) {
  const clean = cleanText(text);
  const target = normalizeVoiceLanguageCode(targetLanguage);
  const source = normalizeVoiceLanguageCode(sourceLanguage) || "auto";

  if (!clean) {
    throw new ApiError(400, "Transcript text is required.", "TEXT_REQUIRED");
  }

  if (String(text || "").trim().length > VOICE_TRANSLATION_MAX_TEXT_LENGTH) {
    throw new ApiError(400, "Transcript is too long to translate.", "TEXT_TOO_LONG");
  }

  if (!target) {
    throw new ApiError(400, "Target language is required.", "TARGET_LANGUAGE_REQUIRED");
  }

  const languages = await listSupportedTranslationLanguages({ fetchImpl });
  const supportedCodes = new Set(languages.map((language) => language.code));
  if (!supportedCodes.has(target) || (source !== "auto" && !supportedCodes.has(source))) {
    throw new ApiError(400, "Unsupported translation language.", "UNSUPPORTED_LANGUAGE");
  }

  if (source !== "auto" && source === target) {
    return {
      detectedLanguage: source,
      provider: "libretranslate",
      sameLanguage: true,
      translatedText: clean,
    };
  }

  const body = {
    format: "text",
    q: clean,
    source,
    target,
    ...(env.libreTranslateApiKey ? { api_key: env.libreTranslateApiKey } : {}),
  };

  const response = await fetchJson(providerUrl("/translate"), {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    fetchImpl,
  });

  return normalizeLibreTranslateResponse(response, source);
}
