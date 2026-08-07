function idFor(value) {
  return String(value?._id || value?.id || value || "");
}

function clean(value, fallback = "") {
  return String(value || fallback).replace(/\s+/gu, " ").trim();
}

function firstNameFor(displayName, username) {
  return clean(displayName, username).split(" ").filter(Boolean)[0] || clean(username, "Friend");
}

export function mutualFollowIds(followingRows = [], followerRows = [], viewerId, blockedIds = new Set()) {
  const viewer = idFor(viewerId);
  const blocked = new Set([...blockedIds].map(String));
  const following = new Set(
    followingRows
      .map((row) => idFor(row.target))
      .filter((id) => id && id !== viewer && !blocked.has(id)),
  );
  const followers = new Set(
    followerRows
      .map((row) => idFor(row.actor))
      .filter((id) => id && id !== viewer && !blocked.has(id)),
  );
  return new Set([...following].filter((id) => followers.has(id)));
}

export function serializeDiscoverStory(story = {}, viewerId, engagement = null) {
  const owner = story.creator || {};
  const ownerId = idFor(owner);
  const mediaUrl = story.image?.url || "";
  return {
    id: idFor(story),
    ownerId,
    creatorId: ownerId,
    owner: {
      id: ownerId,
      name: owner.name || owner.username || "Creator",
      username: owner.username || "",
      avatar: owner.avatar || mediaUrl,
      verified: Boolean(owner.isVerified),
      role: owner.role || "creator",
    },
    name: owner.name || owner.username || "Creator",
    username: owner.username || "",
    avatar: owner.avatar || mediaUrl,
    verified: Boolean(owner.isVerified),
    image: mediaUrl,
    mediaUrl,
    thumbnailUrl: mediaUrl,
    mediaType: story.mediaType || "image",
    duration: story.duration || (story.mediaType === "video" ? 15 : 5),
    editorMetadata: story.editorMetadata,
    audience: story.audience || "everyone",
    allowReactions: story.allowReactions !== false,
    allowReplies: story.allowReplies !== false,
    allowSharing: story.allowSharing !== false,
    caption: story.caption || "",
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    isOwn: Boolean(viewerId && ownerId === idFor(viewerId)),
    viewed: Boolean(engagement?.viewedAt),
    viewerReaction: engagement?.reaction || null,
  };
}

export function serializeDiscoverFriend(user, profile, meta = {}) {
  const id = idFor(user);
  const displayName = user.name || user.username || "Friend";
  const stories = (meta.stories || []).sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0));
  const firstUnseenStory = stories.find((story) => !story.viewed);
  const activeStoryCount = stories.length;
  const hasUnseenStory = Boolean(firstUnseenStory);
  const hasActiveStory = activeStoryCount > 0;
  const hasPremiumOffering = Boolean(meta.hasPremiumOffering);
  const location = profile?.privacySettings?.showLocation === false
    ? { city: "", country: "" }
    : { city: clean(profile?.city), country: clean(profile?.country) };

  return {
    id,
    username: user.username || "",
    displayName,
    name: displayName,
    firstName: firstNameFor(displayName, user.username),
    avatar: user.avatar || "",
    coverImage: profile?.coverPhoto || meta.previewByCreator?.get(id)?.[0] || "",
    category: user.role === "creator" ? profile?.category || "Creator" : profile?.interests?.[0] || "Member",
    city: location.city,
    country: location.country,
    location: [location.city, location.country].filter(Boolean).join(", "),
    isVerified: Boolean(user.isVerified),
    verified: Boolean(user.isVerified),
    isFollowing: true,
    following: true,
    isMutualFollow: true,
    followersCount: meta.followerCounts?.get(id) || 0,
    followers: meta.followerCounts?.get(id) || 0,
    hasActiveStory,
    hasUnseenStory,
    activeStoryCount,
    firstUnseenStoryId: firstUnseenStory?.id || null,
    storyAvailable: hasActiveStory,
    storyViewed: hasActiveStory && !hasUnseenStory,
    stories,
    hasPremiumOffering,
    online: Boolean(meta.online),
    profileUrl: `/profile/${encodeURIComponent(user.username || id)}`,
    role: user.role,
    updatedAt: profile?.updatedAt || user.updatedAt || user.createdAt,
    lastSeenAt: user.lastSeenAt || null,
  };
}

export function sortDiscoverFriends(friends = []) {
  return [...friends].sort((left, right) => {
    const leftRank = left.hasUnseenStory ? 0 : left.hasActiveStory ? 1 : 2;
    const rightRank = right.hasUnseenStory ? 0 : right.hasActiveStory ? 1 : 2;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const activity = new Date(right.lastSeenAt || right.updatedAt || 0) - new Date(left.lastSeenAt || left.updatedAt || 0);
    if (activity) return activity;
    return (left.displayName || left.id).localeCompare(right.displayName || right.id);
  });
}
