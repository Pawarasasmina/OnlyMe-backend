import { serializeContent } from "./contentAccessService.js";
import { serializePublication } from "./publicationAccessService.js";

const safeHttpUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

export function profileViewerCapabilities(owner, viewer, roleProfile = null) {
  const isOwner = Boolean(viewer?._id && String(viewer._id) === String(owner._id));
  const isCreatorOwner = isOwner && owner.role === "creator";
  const approved = isCreatorOwner && owner.creatorApprovalStatus === "approved";
  return {
    isOwner,
    canEditProfile: isOwner,
    canCreate: approved,
    canAccessStudio: approved,
    canAccessVerification: isCreatorOwner,
    canAccessSettings: isOwner,
    canViewDrafts: approved,
    canMessage: Boolean(viewer?._id && !isOwner && viewer.role === "fan" && owner.role === "creator" && roleProfile?.messagingEnabled !== false),
    canFollow: Boolean(viewer?._id && !isOwner && owner.role === "creator" && ["fan", "creator"].includes(viewer.role)),
    canSeePrivateAccountSummary: isOwner,
  };
}

function completion(owner, roleProfile) {
  const checks = owner.role === "creator"
    ? [owner.name, owner.username, owner.avatar, roleProfile?.bio, roleProfile?.categories?.length || roleProfile?.category, owner.isVerified || roleProfile?.verificationStatus !== "not_submitted"]
    : [owner.name, owner.username, owner.avatar, roleProfile?.bio];
  const completed = checks.filter(Boolean).length;
  return { completed, total: checks.length, percentage: Math.round((completed / checks.length) * 100) };
}

function uniquePhotos(items = []) {
  const seen = new Set();
  return items.flatMap((item) => {
    const url = item?.url || item?.secureUrl || item?.mediaUrl || "";
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{
      id: item.id || item._id || url,
      mediaUrl: url,
      mediaType: item.mediaType || item.resourceType || item.type || "image",
      caption: item.caption || item.title || "",
      createdAt: item.createdAt || item.publishedAt || null,
    }];
  });
}

export function serializeUnifiedProfile({ content = [], followerCount = 0, followingCount = 0, owner,  ownWallPosts = [], photos = [], pinnedMessageGroup = null, planets = [], publishedContentCount = content.length, roleProfile, seens = [], sharedSeens = [], sharedWallPosts = [], supporterCount = 0, viewer, viewerRelationships = [] }) {
  const capabilities = profileViewerCapabilities(owner, viewer, roleProfile);
  const contentViewer = capabilities.isOwner ? viewer : null;
  const socialLinks = owner.role === "creator"
    ? (roleProfile?.socialLinks || []).map((item) => ({ platform: item.platform, url: safeHttpUrl(item.url) })).filter((item) => item.url)
    : [];
  const profile = {
    id: roleProfile?._id,
    ownerUserId: owner._id,
    role: owner.role,
    displayName: owner.name,
    username: owner.username,
    avatar: owner.avatar || "",
    cover: owner.role === "creator" ? roleProfile?.coverPhoto || "" : "",
    bio: roleProfile?.bio || "",
    categories: owner.role === "creator" ? (roleProfile?.categories?.length ? roleProfile.categories : roleProfile?.category ? [roleProfile.category] : []) : [],
    location: owner.role === "creator" ? [roleProfile?.city, roleProfile?.country].filter(Boolean).join(", ") : "",
    socialLinks,
    joinedAt: owner.createdAt,
    verified: Boolean(owner.isVerified),
    activeStatus: owner.activeStatus?.isActive ? {
      emoji: owner.activeStatus.emoji || "",
      label: owner.activeStatus.label || "",
      color: owner.activeStatus.color || "",
      presetKey: owner.activeStatus.presetKey || "",
      startedAt: owner.activeStatus.startedAt || null,
      expiresAt: owner.activeStatus.expiresAt || null,
    } : null,
    ...(owner.role === "creator" ? {
      directAccess: {
        enabled: Boolean(roleProfile?.directAccessEnabled),
        priceStars: Number(roleProfile?.directAccessPriceStars || 100),
        durationHours: 48,
        messageLimit: 3,
        callEnabled: Boolean(roleProfile?.directCallEnabled),
        callPriceStars: Number(roleProfile?.directCallPriceStars || 500),
        callDurationMinutes: Number(roleProfile?.directCallDurationMinutes || 5),
      },
    } : {}),
    pinnedMessageGroup: pinnedMessageGroup ? { id: String(pinnedMessageGroup._id), name: pinnedMessageGroup.name, avatarUrl: pinnedMessageGroup.avatar || null, memberCount: pinnedMessageGroup.members?.length || 0 } : null,
  };

  if (capabilities.isOwner && owner.role === "creator") {
    profile.creatorApprovalStatus = owner.creatorApprovalStatus || "pending";
    profile.creatorVerificationStatus = owner.isVerified ? "verified" : roleProfile?.verificationStatus || "not_submitted";
  }

  return {
    profile,
    publicMetrics: { publishedContentCount, followerCount, followingCount, supporterCount },
    publicContent: content.map((item) => serializeContent(item, contentViewer)),
    photos: uniquePhotos(photos).slice(0, 12),
    seens: seens.map((item) => serializePublication(item, contentViewer)).filter(Boolean),
    sharedSeens: sharedSeens.map((item) => { const publication = serializePublication(item, contentViewer); return publication ? { ...publication, shareCaption: item.shareCaption || "" } : null; }).filter(Boolean),
    sharedWallPosts: sharedWallPosts
      .map((item) => item.author ? item : ({ id: `share-${item.shareId}`, originalPostId: item._id, shareId: item.shareId, text: item.text, shareCaption: item.shareCaption || "", context: item.context, location: item.location, media: item.media || [], createdAt: item.createdAt, feedCreatedAt: item.feedCreatedAt, sharedBy: { id: owner._id, name: owner.name, username: owner.username, avatar: owner.avatar || "", verified: Boolean(owner.isVerified) }, reactionCount: item.engagement?.reactionCount || 0, reactionBreakdown: item.engagement?.reactionBreakdown || {}, topReactions: item.engagement?.topReactions || [], viewerReaction: item.engagement?.viewerReaction || null, commentCount: item.engagement?.commentCount || 0, shareCount: item.engagement?.shareCount || 0, saveCount: item.engagement?.saveCount || 0, viewerShared: Boolean(item.engagement?.viewerShared), viewerSaved: Boolean(item.engagement?.viewerSaved), creator: { name: item.creator?.name, username: item.creator?.username, avatar: item.creator?.avatar || "", verified: Boolean(item.creator?.isVerified) } }))
      .sort((left, right) => new Date(right.feedCreatedAt || right.createdAt) - new Date(left.feedCreatedAt || left.createdAt)),
    wallPosts: ownWallPosts,
    planets: planets.map((item) => serializePublication(item, contentViewer)).filter(Boolean).slice(0, 3),
    viewerCapabilities: capabilities,
    viewerRelationship: { following: viewerRelationships.some((item) => item.type === "FOLLOW"), seeSignalSent: viewerRelationships.some((item) => item.type === "SEE_SIGNAL") },
    ...(capabilities.isOwner ? { profileCompletion: completion(owner, roleProfile) } : {}),
  };
}
