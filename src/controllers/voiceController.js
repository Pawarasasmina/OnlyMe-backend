import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { transcribeVoiceNote } from "../services/transcriptionService.js";
import { listSupportedTranslationLanguages, translateVoiceTranscript } from "../services/translationService.js";
import {
  VOICE_TRANSLATION_MAX_TEXT_LENGTH,
  normalizeVoiceLanguageCode,
} from "../../../shared/voiceTranslationLanguages.js";

export const transcribeWallVoiceNote = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "Audio file is required.", "AUDIO_REQUIRED");
  }

  const result = await transcribeVoiceNote({
    buffer: req.file.buffer,
    filename: req.file.originalname || "voice-note.webm",
    mimeType: req.file.mimetype || "audio/webm",
  });

  return sendResponse(res, 200, result.emptySpeech ? "No speech was detected" : "Voice note transcribed", result);
});

function readTranslationPayload(body = {}) {
  const text = String(body.text || "").trim().replace(/\r\n/g, "\n");
  const targetLanguage = normalizeVoiceLanguageCode(body.targetLanguage);
  const sourceLanguage = normalizeVoiceLanguageCode(body.sourceLanguage);

  if (!text) {
    throw new ApiError(400, "Transcript text is required.", "TEXT_REQUIRED");
  }

  if (text.length > VOICE_TRANSLATION_MAX_TEXT_LENGTH) {
    throw new ApiError(400, "Transcript is too long to translate.", "TEXT_TOO_LONG");
  }

  if (!targetLanguage) {
    throw new ApiError(400, "Target language is required.", "TARGET_LANGUAGE_REQUIRED");
  }

  return {
    sourceLanguage: sourceLanguage || "auto",
    targetLanguage,
    text,
  };
}

export const listVoiceTranslationLanguages = asyncHandler(async (_req, res) => {
  const languages = await listSupportedTranslationLanguages();
  return sendResponse(res, 200, "Voice translation languages fetched", {
    languages,
    maxTextLength: VOICE_TRANSLATION_MAX_TEXT_LENGTH,
  });
});

export const translateWallVoiceTranscript = asyncHandler(async (req, res) => {
  const payload = readTranslationPayload(req.body);
  const result = await translateVoiceTranscript(payload);

  return sendResponse(res, 200, result.sameLanguage ? "Transcript is already in this language" : "Voice transcript translated", {
    detectedLanguage: result.detectedLanguage || "",
    provider: result.provider,
    sameLanguage: Boolean(result.sameLanguage),
    translatedText: result.translatedText,
  });
});
