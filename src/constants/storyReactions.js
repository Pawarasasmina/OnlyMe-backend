export const STORY_QUICK_REACTIONS = ["👁️", "❤️", "🔥", "🥹", "😂", "🤝"];
export const STORY_REACTIONS = [...STORY_QUICK_REACTIONS, "😮", "👏", "😍", "😢", "🤗", "💪", "🙏", "💯", "✨"];
export const isStoryReaction = (value) => STORY_REACTIONS.some((emoji) => emoji.replace(/\uFE0F/g, "") === String(value).replace(/\uFE0F/g, ""));
