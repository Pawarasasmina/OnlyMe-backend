export const STATUS_PRESETS = Object.freeze({
  at_seen: { color: "#9CCBFF", defaultDurationHours: 2, emoji: "👁", label: "At seen" },
  right_now: { color: "#6ECF97", defaultDurationHours: 2, emoji: "⚡", label: "Right now" },
  at_gym: { color: "#F3A85E", defaultDurationHours: 3, emoji: "🏋️", label: "At the gym" },
  celebrating: { color: "#F6D365", defaultDurationHours: 4, emoji: "🎉", label: "Celebrating" },
  coffee_break: { color: "#C8A27A", defaultDurationHours: 2, emoji: "☕", label: "Coffee break" },
  traveling: { color: "#B092FF", defaultDurationHours: 6, emoji: "✈️", label: "Traveling" },
  working: { color: "#9CCBFF", defaultDurationHours: 4, emoji: "💻", label: "Working" },
  relaxing: { color: "#A7D8C4", defaultDurationHours: 3, emoji: "🌙", label: "Relaxing" },
});

export const CUSTOM_STATUS_PRESET_KEY = "custom";
export const STATUS_LABEL_MAX_LENGTH = 32;
export const STATUS_EMOJI_MAX_LENGTH = 4;
export const DEFAULT_CUSTOM_STATUS_HOURS = 2;

