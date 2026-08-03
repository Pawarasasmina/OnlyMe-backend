import ApiError from "../utils/ApiError.js";

const colors = new Set(["#FFFFFF", "#8AB8FF", "#6ECF97", "#F17878", "#FACC15"]);
const alignments = new Set(["left", "center", "right"]);
const backgrounds = new Set(["none", "pill", "solid", "translucent"]);
const audiences = new Set(["everyone", "followers", "close_circle", "only_me"]);
const finite = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
const text = (value, max) => String(value || "").trim().slice(0, max);

export function parseStoryEditorMetadata(value) {
  let input = value;
  if (typeof value === "string") {
    if (value.length > 250000) throw new ApiError(400, "Story editor data is too large");
    try { input = JSON.parse(value); } catch { throw new ApiError(400, "Story editor data is invalid"); }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
  const transform = input.transform || {};
  return {
    transform: {
      scale: finite(transform.scale, 1, 1, 2.2),
      translateX: finite(transform.translateX, 0, -35, 35),
      translateY: finite(transform.translateY, 0, -35, 35),
      rotation: finite(transform.rotation, 0, -180, 180),
    },
    textOverlays: (Array.isArray(input.textOverlays) ? input.textOverlays : []).slice(0, 10).map((item, index) => ({
      id: text(item.id, 100) || `text-${index}`,
      text: text(item.text, 80),
      color: colors.has(String(item.color).toUpperCase()) ? String(item.color).toUpperCase() : "#FFFFFF",
      fontSize: finite(item.fontSize, 28, 16, 54),
      fontWeight: finite(item.fontWeight, 800, 400, 900),
      align: alignments.has(item.align) ? item.align : "center",
      background: backgrounds.has(item.background) ? item.background : "pill",
      x: finite(item.x, 50, 0, 100),
      y: finite(item.y, 50, 0, 100),
    })).filter((item) => item.text),
    stickers: (Array.isArray(input.stickers) ? input.stickers : []).slice(0, 20).map((item, index) => ({
      id: text(item.id, 100) || `sticker-${index}`,
      value: text(item.value, 20),
      x: finite(item.x, 50, 0, 100),
      y: finite(item.y, 50, 0, 100),
      scale: finite(item.scale, 1, 0.5, 3),
      rotation: finite(item.rotation, 0, -180, 180),
    })).filter((item) => item.value),
    drawing: (Array.isArray(input.drawing) ? input.drawing : []).slice(0, 30).map((stroke, index) => ({
      id: text(stroke.id, 100) || `stroke-${index}`,
      color: colors.has(String(stroke.color).toUpperCase()) ? String(stroke.color).toUpperCase() : "#8AB8FF",
      size: finite(stroke.size, 1.5, 0.5, 8),
      points: (Array.isArray(stroke.points) ? stroke.points : []).slice(0, 1000).map((point) => ({ x: finite(point.x, 0, 0, 100), y: finite(point.y, 0, 0, 177.777) })),
    })).filter((stroke) => stroke.points.length > 1),
  };
}

export function parseStoryOptions(body = {}) {
  return {
    audience: audiences.has(body.audience) ? body.audience : "everyone",
    allowReactions: body.allowReactions !== "false" && body.allowReactions !== false,
    allowReplies: body.allowReplies !== "false" && body.allowReplies !== false,
    allowSharing: body.allowSharing !== "false" && body.allowSharing !== false,
  };
}
