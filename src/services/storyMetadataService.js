import ApiError from "../utils/ApiError.js";

const colors = new Set(["#FFFFFF", "#D6EAFF", "#9CCBFF", "#8AB8FF", "#6ECF97", "#F17878", "#FACC15", "#0A0C0F"]);
const alignments = new Set(["left", "center", "right"]);
const backgrounds = new Set(["none", "pill", "solid", "translucent"]);
const audiences = new Set(["everyone", "followers", "close_circle", "only_me", "world"]);
const cardVariants = new Set(["compact", "long"]);
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
  const mediaFramingInput = input.mediaFraming && typeof input.mediaFraming === "object" && !Array.isArray(input.mediaFraming)
    ? input.mediaFraming
    : null;
  const inputQuestionSticker = input.questionSticker && typeof input.questionSticker === "object" && !Array.isArray(input.questionSticker)
    ? input.questionSticker
    : null;
  const questionPrompt = text(inputQuestionSticker?.prompt, 60) || "Ask me anything";
  const inputSharedCard = input.sharedCard && typeof input.sharedCard === "object" && !Array.isArray(input.sharedCard)
    ? input.sharedCard
    : null;
  const destinationRoute = text(inputSharedCard?.destinationRoute, 180);
  const sharedCard = inputSharedCard && (/^\/(?:seen|posts|stories)\/[a-zA-Z0-9_-]+$/.test(destinationRoute) || /^\/wall\?note=[a-f0-9]{24}$/i.test(destinationRoute) || inputSharedCard.kind === "question_reply" && !destinationRoute) ? {
    destinationRoute,
    ...(text(inputSharedCard.eyebrow, 100) ? { eyebrow: text(inputSharedCard.eyebrow, 100) } : {}),
    ...(colors.has(String(inputSharedCard.cardBackgroundColor).toUpperCase()) ? { cardBackgroundColor: String(inputSharedCard.cardBackgroundColor).toUpperCase() } : {}),
    ...(colors.has(String(inputSharedCard.cardTextColor).toUpperCase()) ? { cardTextColor: String(inputSharedCard.cardTextColor).toUpperCase() } : {}),
    ...(text(inputSharedCard.excerpt, 280) ? { excerpt: text(inputSharedCard.excerpt, 280) } : {}),
    imageUrl: text(inputSharedCard.imageUrl, 2000),
    kind: text(inputSharedCard.kind, 20) || "post",
    ...(inputSharedCard.kind === "note" ? { authorName: text(inputSharedCard.authorName, 100), authorAvatar: text(inputSharedCard.authorAvatar, 2000) } : {}),
    ...(inputSharedCard.mediaType === "video" ? { mediaType: "video" } : {}),
    points: (Array.isArray(inputSharedCard.points) ? inputSharedCard.points : []).slice(0, 2).map((item) => text(item, 60)).filter(Boolean),
    subtitle: text(inputSharedCard.subtitle, 100),
    title: text(inputSharedCard.title, inputSharedCard.kind === "note" ? 400 : 120) || "View post",
    ...(text(inputSharedCard.originalTranscript, 2000) ? { originalTranscript: text(inputSharedCard.originalTranscript, 2000) } : {}),
    ...(text(inputSharedCard.translationText, 2000) ? { translationText: text(inputSharedCard.translationText, 2000) } : {}),
    ...(text(inputSharedCard.translationLabel, 80) ? { translationLabel: text(inputSharedCard.translationLabel, 80) } : {}),
    ...(inputSharedCard.displayMode === "text_only" ? { displayMode: "text_only" } : {}),
    variant: cardVariants.has(inputSharedCard.variant) ? inputSharedCard.variant : "compact",
    scale: finite(inputSharedCard.scale, 1, .4, 3),
    x: finite(inputSharedCard.x, 50, 16, 84),
    y: finite(inputSharedCard.y, 50, 20, 78),
  } : null;
  return {
    ...(input.flattened === true ? { flattened: true } : {}),
    mentions: (Array.isArray(input.mentions) ? input.mentions : []).slice(0, 10)
      .filter((item, index, items) => /^[a-f\d]{24}$/i.test(String(item?.userId || "")) && items.findIndex((other) => String(other?.userId) === String(item.userId)) === index)
      .map((item) => ({ userId: String(item.userId), st: item.st === 1 ? 1 : 0, x: finite(item.x, 50, -5, 105), y: finite(item.y, 50, -2, 102), scale: finite(item.scale, 1, 0.5, 3), rotation: finite(item.rotation, 0, -180, 180) })),
    ...(mediaFramingInput ? {
      mediaFraming: {
        fitMode: mediaFramingInput.fitMode === "fit" ? "fit" : "fill",
        scale: finite(mediaFramingInput.scale, 1, 0.4, 4),
        translateX: finite(mediaFramingInput.translateX, 0, -100, 100),
        translateY: finite(mediaFramingInput.translateY, 0, -100, 100),
      },
    } : {}),
    transform: {
      scale: finite(transform.scale, 1, 0.4, 4),
      translateX: finite(transform.translateX, 0, -35, 35),
      translateY: finite(transform.translateY, 0, -35, 35),
      rotation: finite(transform.rotation, 0, -180, 180),
    },
    textOverlays: (Array.isArray(input.textOverlays) ? input.textOverlays : []).filter((item) => item && typeof item === "object").slice(0, 10).map((item, index) => ({
      id: text(item.id, 100) || `text-${index}`,
      text: text(item.text, 300),
      style: [0, 1, 2, 3, 4, 5].includes(Number(item.style)) ? Number(item.style) : 0,
      backgroundMode: [0, 1, 2].includes(Number(item.backgroundMode)) ? Number(item.backgroundMode) : Number(item.style) === 2 ? 1 : 0,
      rotation: finite(item.rotation, 0, -180, 180),
      color: colors.has(String(item.color).toUpperCase()) ? String(item.color).toUpperCase() : "#FFFFFF",
      fontSize: finite(item.fontSize, 28, 12, 96),
      fontWeight: finite(item.fontWeight, 800, 400, 900),
      align: alignments.has(item.align) ? item.align : "center",
      background: backgrounds.has(item.background) ? item.background : "pill",
      x: finite(item.x, 50, -5, 105),
      y: finite(item.y, 50, -2, 102),
    })).filter((item) => item.text),
    stickers: (Array.isArray(input.stickers) ? input.stickers : []).filter((item) => item && typeof item === "object").slice(0, 20).map((item, index) => ({
      id: text(item.id, 100) || `sticker-${index}`,
      value: text(item.value, 20),
      x: finite(item.x, 50, 0, 100),
      y: finite(item.y, 50, 0, 100),
      scale: finite(item.scale, 1, 0.5, 3),
      rotation: finite(item.rotation, 0, -180, 180),
    })).filter((item) => item.value),
    drawing: (Array.isArray(input.drawing) ? input.drawing : []).filter((item) => item && typeof item === "object").slice(0, 30).map((stroke, index) => ({
      id: text(stroke.id, 100) || `stroke-${index}`,
      color: colors.has(String(stroke.color).toUpperCase()) ? String(stroke.color).toUpperCase() : "#8AB8FF",
      size: finite(stroke.size, 1.5, 0.5, 8),
      points: (Array.isArray(stroke.points) ? stroke.points : []).filter((point) => point && typeof point === "object").slice(0, 1000).map((point) => ({ x: finite(point.x, 0, 0, 100), y: finite(point.y, 0, 0, 177.777) })),
    })).filter((stroke) => stroke.points.length > 1),
    ...(inputQuestionSticker ? {
      questionSticker: {
        id: text(inputQuestionSticker.id, 100) || "question",
        prompt: questionPrompt,
        x: finite(inputQuestionSticker.x, 50, -5, 105),
        y: finite(inputQuestionSticker.y, 63, -2, 102),
        ...(inputQuestionSticker.scale != null ? { scale: finite(inputQuestionSticker.scale, 1, .5, 3) } : {}),
        ...(inputQuestionSticker.rotation != null ? { rotation: finite(inputQuestionSticker.rotation, 0, -180, 180) } : {}),
      },
    } : {}),
    ...(sharedCard ? { sharedCard } : {}),
  };
}

export function parseStoryOptions(body = {}) {
  const audience = body.audience === "friends" ? "close_circle" : body.audience || "everyone";
  if (!audiences.has(audience)) throw new ApiError(400, "Invalid story audience");
  return {
    audience,
    allowReactions: body.allowReactions !== "false" && body.allowReactions !== false,
    allowReplies: body.allowReplies !== "false" && body.allowReplies !== false,
    allowSharing: body.allowSharing !== "false" && body.allowSharing !== false,
  };
}
