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

export function profileViewerCapabilities(owner, viewer) {
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
    canMessage: false,
    canFollow: false,
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

export function serializeUnifiedProfile({ content = [], owner, planets = [], publishedContentCount = content.length, roleProfile, seens = [], sharedSeens = [], viewer }) {
  const capabilities = profileViewerCapabilities(owner, viewer);
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
  };

  if (capabilities.isOwner && owner.role === "creator") {
    profile.creatorApprovalStatus = owner.creatorApprovalStatus || "pending";
    profile.creatorVerificationStatus = owner.isVerified ? "verified" : roleProfile?.verificationStatus || "not_submitted";
  }

  return {
    profile,
    publicMetrics: { publishedContentCount },
    publicContent: content.map((item) => serializeContent(item, contentViewer)),
    seens: seens.map((item) => serializePublication(item, contentViewer)).filter(Boolean),
    sharedSeens: sharedSeens.map((item) => serializePublication(item, contentViewer)).filter(Boolean),
    planets: planets.map((item) => serializePublication(item, contentViewer)).filter(Boolean).slice(0, 3),
    viewerCapabilities: capabilities,
    ...(capabilities.isOwner ? { profileCompletion: completion(owner, roleProfile) } : {}),
  };
}
