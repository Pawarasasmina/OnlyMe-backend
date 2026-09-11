import {
  CUSTOM_STATUS_PRESET_KEY,
  DEFAULT_CUSTOM_STATUS_HOURS,
  STATUS_EMOJI_MAX_LENGTH,
  STATUS_LABEL_MAX_LENGTH,
  STATUS_PRESETS,
} from "../constants/statusPresets.js";
import ApiError from "../utils/ApiError.js";

const withoutControlCharacters = (value) => Array.from(String(value ?? ""))
  .filter((character) => {
    const code = character.charCodeAt(0);
    return code > 31 && code !== 127;
  })
  .join("");

const sanitizeText = (value, max = STATUS_LABEL_MAX_LENGTH) => withoutControlCharacters(value).trim().slice(0, max);

const normalizePlainText = (value) => withoutControlCharacters(value).trim();

const sanitizeEmoji = (value) => Array.from(String(value || "").trim()).slice(0, STATUS_EMOJI_MAX_LENGTH).join("");

export const isActiveStatus = (status) => Boolean(status?.isActive && status?.expiresAt && new Date(status.expiresAt).getTime() > Date.now());

export const isProfileStatusVisible = (status) => Boolean(status?.isActive && String(status.label || "").trim());

export const serializeStatus = (status) => {
  if (!isActiveStatus(status)) return null;
  const preset = STATUS_PRESETS[status.presetKey] || null;
  return {
    emoji: status.emoji || preset?.emoji || "",
    label: status.label || preset?.label || "",
    presetKey: status.presetKey || "",
    isCustom: Boolean(status.isCustom),
    color: status.color || preset?.color || "#9CCBFF",
    startedAt: status.startedAt || null,
    expiresAt: status.expiresAt,
  };
};

export function inactiveStatus() {
  return { isActive: false, emoji: "", label: "", presetKey: "", isCustom: false, color: "", startedAt: null, expiresAt: null };
}

export function serializeProfileStatus(status) {
  if (!isProfileStatusVisible(status)) return null;
  const preset = STATUS_PRESETS[status.presetKey] || null;
  return {
    emoji: status.emoji || preset?.emoji || "",
    label: status.label || preset?.label || "",
    presetKey: status.presetKey || "",
    isCustom: Boolean(status.isCustom),
    color: status.color || preset?.color || "#9CCBFF",
    startedAt: status.startedAt || null,
    updatedAt: status.startedAt || null,
  };
}

export function buildProfileStatusFromPayload(payload = {}, now = new Date()) {
  if (payload.clear === true || payload.status === null) {
    return { activeStatus: inactiveStatus(), cleared: true };
  }
  if (typeof payload.status !== "string") {
    throw new ApiError(400, "Status must be text");
  }

  const label = normalizePlainText(payload.status);
  if (!label) throw new ApiError(400, "Status text is required");
  if (Array.from(label).length > STATUS_LABEL_MAX_LENGTH) {
    throw new ApiError(400, `Status must be ${STATUS_LABEL_MAX_LENGTH} characters or fewer`);
  }

  const firstEmoji = label.match(/^\p{Extended_Pictographic}(?:\uFE0F)?/u)?.[0] || "";
  return {
    activeStatus: {
      emoji: firstEmoji,
      label,
      presetKey: CUSTOM_STATUS_PRESET_KEY,
      isCustom: true,
      color: "#9CCBFF",
      startedAt: now,
      expiresAt: null,
      isActive: true,
    },
    cleared: false,
  };
}

export function buildStatusFromPayload(payload = {}, currentStatus = null, now = new Date()) {
  const clearRequested = payload.clear === true || payload.presetKey === null || payload.presetKey === "";
  if (clearRequested) return { activeStatus: inactiveStatus(), cleared: true };

  const presetKey = sanitizeText(payload.presetKey, 40);
  const isCustom = presetKey === CUSTOM_STATUS_PRESET_KEY || payload.isCustom === true;
  const preset = STATUS_PRESETS[presetKey];
  if (!isCustom && !preset) throw new ApiError(400, "Choose a valid status");

  if (currentStatus && !isCustom && currentStatus.presetKey === presetKey) {
    return { activeStatus: inactiveStatus(), cleared: true };
  }

  const label = isCustom ? sanitizeText(payload.label) : preset.label;
  const emoji = isCustom ? sanitizeEmoji(payload.emoji) : preset.emoji;
  const color = isCustom ? sanitizeText(payload.color, 20) || "#9CCBFF" : preset.color;
  if (!label) throw new ApiError(400, "Status text is required");
  if (!emoji) throw new ApiError(400, "Status emoji is required");

  const durationHours = Math.max(1, Math.min(24, Number(payload.durationHours) || preset?.defaultDurationHours || DEFAULT_CUSTOM_STATUS_HOURS));
  return {
    activeStatus: {
      emoji,
      label,
      presetKey: isCustom ? CUSTOM_STATUS_PRESET_KEY : presetKey,
      isCustom,
      color,
      startedAt: now,
      expiresAt: new Date(now.getTime() + durationHours * 60 * 60 * 1000),
      isActive: true,
    },
    cleared: false,
  };
}

