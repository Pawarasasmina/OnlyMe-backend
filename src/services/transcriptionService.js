import { DeepgramClient } from "@deepgram/sdk";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

function cleanTranscript(value) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, 2000);
}

function normalizeConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function transcriptionAvailable() {
  return Boolean(env.deepgramApiKey);
}

export function normalizeDeepgramTranscription(response = {}) {
  const alternative = response?.results?.channels?.[0]?.alternatives?.[0] || {};
  const transcript = cleanTranscript(alternative.transcript);
  return {
    confidence: normalizeConfidence(alternative.confidence),
    emptySpeech: transcript.length === 0,
    transcript,
  };
}

function deepgramClient() {
  if (!transcriptionAvailable()) {
    throw new ApiError(503, "Voice transcription is not configured.", "TRANSCRIPTION_NOT_CONFIGURED");
  }
  return new DeepgramClient({ apiKey: env.deepgramApiKey });
}

export async function transcribeVoiceNote({
  buffer,
  client = null,
  filename = "voice-note.webm",
  mimeType = "audio/webm",
  signal,
} = {}) {
  if (!buffer) {
    throw new ApiError(400, "Audio file is required.", "AUDIO_REQUIRED");
  }

  if (!buffer.length) {
    throw new ApiError(400, "Audio file is empty.", "INVALID_AUDIO");
  }

  if (buffer.length > env.maxVoiceNoteSizeBytes) {
    throw new ApiError(400, `Voice notes must be ${Math.round(env.maxVoiceNoteSizeBytes / 1024 / 1024)} MB or smaller.`, "AUDIO_TOO_LARGE");
  }

  try {
    const response = await (client || deepgramClient()).listen.v1.media.transcribeFile(
      {
        contentLength: buffer.length,
        contentType: mimeType,
        data: buffer,
        filename,
      },
      {
        model: env.deepgramTranscriptionModel,
        smart_format: true,
      },
      {
        abortSignal: signal,
        maxRetries: 1,
        timeoutInSeconds: 60,
      }
    );

    return {
      configured: true,
      model: env.deepgramTranscriptionModel,
      provider: "deepgram",
      ...normalizeDeepgramTranscription(response),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") {
      throw new ApiError(408, "Voice transcription timed out.", "TRANSCRIPTION_TIMEOUT");
    }
    throw new ApiError(502, "Could not transcribe the voice note.", "TRANSCRIPTION_FAILED");
  }
}
