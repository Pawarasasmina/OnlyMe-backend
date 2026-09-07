import Content from "../models/Content.js";
import CallSession from "../models/CallSession.js";
import DAWindow from "../models/DAWindow.js";
import FanProfile from "../models/FanProfile.js";
import FeedPost from "../models/FeedPost.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Subscription from "../models/Subscription.js";
import Transaction from "../models/Transaction.js";
import Wallet from "../models/Wallet.js";
import SeenEngagement from "../models/SeenEngagement.js";
import WallEngagement from "../models/WallEngagement.js";
import WallShareEngagement from "../models/WallShareEngagement.js";
import OrbitSignal from "../models/OrbitSignal.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

const DEFAULT_LIMITS = {
  dashboardSubscriptions: 3,
  dashboardTransactions: 5,
  dashboardPurchases: 4,
  dashboardConversations: 5,
  dashboardActivity: 8,
  pageSize: 50,
};

function limitFromQuery(value, fallback = DEFAULT_LIMITS.pageSize) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), 100);
}

function profileCompletion(user) {
  const checks = [Boolean(user.name), Boolean(user.username), Boolean(user.avatar)];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

async function ensureFanProfile(userId) {
  return FanProfile.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

function serializeProfile(user, profile) {
  return {
    displayName: user.name,
    username: user.username,
    avatarUrl: user.avatar || null,
    email: user.email,
    profileVisibility: profile?.profileVisibility || "private",
    joinedAt: user.createdAt,
    preferredLanguage: profile?.preferredLanguage || null,
    timezone: profile?.timezone || null,
    completionPercentage: profileCompletion(user),
  };
}

function serializeCreator(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id ? String(user._id) : user.id,
    displayName: user.name,
    username: user.username,
    avatarUrl: user.avatar || null,
    avatar: user.avatar || null,
  };
}

function textPreview(value = "", max = 110) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function publicationTitle(publication) {
  return publication?.title || publication?.publishedSnapshot?.metadata?.title || publication?.summary || "Seen";
}

function publicationRoute(publication) {
  if (!publication?._id) return null;
  return publication.kind?.includes("WORLD") ? `/world/${publication._id}` : `/seen/${publication._id}`;
}

function publicationTarget(publication) {
  if (!publication) return null;
  return {
    id: String(publication._id),
    type: publication.kind || "SEEN",
    title: publicationTitle(publication),
    preview: textPreview(publication.summary || publication.description || publicationTitle(publication)),
  };
}

function wallTarget(post) {
  if (!post) return null;
  return {
    id: String(post._id),
    type: "WALL_POST",
    title: "Wall post",
    preview: textPreview(post.text),
  };
}

function activityBase(input) {
  const target = input.target || null;
  return {
    id: input.id,
    type: input.type,
    direction: input.direction || "received",
    filter: input.filter || "other",
    filterKeys: input.filterKeys || [input.filter || "other"],
    description: input.description || input.title || "Activity",
    title: input.title || input.description || "Activity",
    preview: input.preview || target?.preview || "",
    createdAt: input.createdAt,
    relatedCreator: input.actor || input.relatedCreator || null,
    relatedContent: input.relatedContent || (target ? { title: target.title, type: target.type } : null),
    actionPath: input.actionPath || input.route || null,
    route: input.route || input.actionPath || null,
    actor: input.actor || null,
    target,
    amount: input.amount || null,
    currency: input.currency || null,
    starsChange: input.starsChange ?? null,
    aggregate: input.aggregate || null,
    canAcknowledge: input.canAcknowledge ?? true,
    acknowledged: Boolean(input.acknowledged),
    read: Boolean(input.read),
    warningId: input.warningId || null,
    severity: input.severity || null,
    priority: input.priority || 0,
    event: input.event || null,
    reference: input.reference || null,
    dedupeKey: input.dedupeKey || null,
    metadata: input.metadata || {},
  };
}

function notificationActivity(notification) {
  const isWarning = notification.type === "moderation_warning";
  const financial = /earning|refund|wallet|stars|debit|credit/i.test(`${notification.type} ${notification.title}`);
  const filter = isWarning ? "moderation" : financial ? "earnings" : "system";

  return activityBase({
    id: `notification-${notification._id}`,
    warningId: isWarning ? String(notification._id) : null,
    type: notification.type || "notification",
    direction: "received",
    filter,
    filterKeys: filter === "moderation" ? ["system"] : [filter],
    title: notification.title,
    description: isWarning ? (notification.message || notification.title) : notification.title,
    preview: isWarning ? notification.message : notification.message,
    severity: notification.severity,
    priority: notification.priority || 0,
    acknowledged: Boolean(notification.acknowledgedAt || notification.readAt),
    read: Boolean(notification.readAt),
    createdAt: notification.createdAt,
    actionPath: isWarning ? "/settings/support/safety" : null,
    dedupeKey: notification.dedupeKey || null,
    canAcknowledge: true,
  });
}

function transactionActivity(transaction) {
  const direction = transactionDirection(transaction);
  const signed = direction === "credit" ? Math.abs(Number(transaction.amount) || 0) : -Math.abs(Number(transaction.amount) || 0);
  return activityBase({
    id: `transaction-${transaction._id}`,
    type: direction === "credit" ? "wallet_credit" : "wallet_debit",
    direction: direction === "credit" ? "received" : "sent",
    filter: direction === "credit" ? "earnings" : "purchases",
    filterKeys: [direction === "credit" ? "earnings" : "purchases"],
    title: transaction.description || (direction === "credit" ? "Wallet credit" : "Wallet debit"),
    createdAt: transaction.createdAt,
    actionPath: "/wallet/ledger",
    starsChange: signed,
  });
}

function followActivity(row, direction) {
  const actor = direction === "received" ? row.actor : row.target;
  const name = actor?.name || actor?.username || "Someone";
  return activityBase({
    id: `follow-${direction}-${row._id}`,
    type: "follow",
    direction,
    filter: "follows",
    filterKeys: ["follows"],
    title: direction === "received" ? `${name} started following you` : `You followed ${name}`,
    createdAt: row.createdAt,
    actor: serializeCreator(actor),
    actionPath: actor?.username ? `/profile/${encodeURIComponent(actor.username)}` : "/profile",
    canAcknowledge: direction === "received",
  });
}

function orbitActivity(signal, direction) {
  const actor = direction === "received" ? signal.sender : signal.targetUser;
  const name = actor?.name || actor?.username || "Someone";
  return activityBase({
    id: `profile-see-${direction}-${signal._id}`,
    type: "profile_seen",
    direction,
    filter: "seen",
    filterKeys: ["seen"],
    title: direction === "received" ? `${name} sees you` : `You see ${name}`,
    createdAt: signal.signaledAt || signal.createdAt,
    actor: serializeCreator(actor),
    actionPath: actor?.username ? `/profile/${encodeURIComponent(actor.username)}` : "/orbit",
    acknowledged: Boolean(signal.acknowledgedAt),
    canAcknowledge: direction === "received",
  });
}

function engagementVerb(type, direction, targetName) {
  if (type === "SAVE") return direction === "received" ? `saved your ${targetName}` : `saved ${targetName}`;
  if (type === "COMMENT") return direction === "received" ? `commented on your ${targetName}` : `commented on ${targetName}`;
  if (type === "REACTION") return direction === "received" ? `reacted to your ${targetName}` : `reacted to ${targetName}`;
  if (type === "SHARE") return direction === "received" ? `reposted your ${targetName}` : `reposted ${targetName}`;
  return direction === "received" ? `engaged with your ${targetName}` : `engaged with ${targetName}`;
}

function reactionLabel(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  const labels = {
    like: "Support",
    LIKE: "Support",
    love: "Love",
    LOVE: "Love",
    care: "Care",
    fire: "Fire",
    FIRE: "Fire",
    clap: "Clap",
    CLAP: "Clap",
    laugh: "Laugh",
    LAUGH: "Laugh",
    see_you: "See You",
    SEE_YOU: "See You",
    useful: "Useful",
    wow: "Wow",
    WOW: "Wow",
    sad: "Sad",
    SAD: "Sad",
    phone: "Call",
    PHONE: "Call",
    strong: "Strong",
    STRONG: "Strong",
    pray: "Respect",
    PRAY: "Respect",
    INSIGHTFUL: "Insightful",
  };
  return labels[key] || key.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reactionActivityTitle({ direction, name, reaction, targetName }) {
  const label = reactionLabel(reaction);
  const reactionCopy = label ? ` with ${label}` : "";
  return direction === "received"
    ? `${name} reacted${reactionCopy} to your ${targetName}`
    : `You reacted${reactionCopy} to ${targetName}`;
}

function engagementTime(row) {
  if (["REACTION", "SHARE", "SAVE"].includes(row.type) && row.updatedAt) return row.updatedAt;
  return row.createdAt || row.updatedAt;
}

function engagementActivity(row, { direction, source }) {
  const target = source === "seen" ? publicationTarget(row.publication) : wallTarget(row.post);
  if (!target) return null;
  const targetLabel = source === "seen" ? "Seen" : "note";
  const otherUser = direction === "received" ? row.user : source === "seen" ? row.publication?.creator : row.post?.creator;
  const actor = serializeCreator(otherUser);
  const name = actor?.displayName || actor?.username || "Someone";
  const title = row.type === "REACTION"
    ? reactionActivityTitle({ direction, name, reaction: row.reaction, targetName: direction === "received" ? targetLabel : `${name}'s ${targetLabel}` })
    : direction === "received"
      ? `${name} ${engagementVerb(row.type, direction, targetLabel)}`
      : `You ${engagementVerb(row.type, direction, `${name}'s ${targetLabel}`)}`;
  return activityBase({
    id: `${source}-${String(row.type || "engagement").toLowerCase()}-${direction}-${row._id}`,
    type: `${source}_${String(row.type || "engagement").toLowerCase()}`,
    direction,
    filter: row.type === "SAVE" ? "saves" : row.type === "COMMENT" ? "comments" : "support",
    filterKeys: [row.type === "SAVE" ? "saves" : row.type === "COMMENT" ? "comments" : "support"],
    title,
    preview: row.type === "COMMENT" ? textPreview(row.text || target.preview) : target.preview,
    createdAt: engagementTime(row),
    actor,
    target,
    actionPath: source === "seen" ? publicationRoute(row.publication) : `/posts/${row.post._id}`,
    canAcknowledge: direction === "received",
    metadata: { reaction: row.reaction || null },
  });
}

function feedPostEngagementActivity(post, row, { direction, type }) {
  if (!post || !row) return null;
  const target = wallTarget(post);
  if (!target) return null;

  const otherUser = direction === "received" ? row.user : post.author;
  const actor = serializeCreator(otherUser);
  const name = actor?.displayName || actor?.username || "Someone";
  const targetName = direction === "received" ? "note" : `${name}'s note`;
  const title = type === "REACTION"
    ? reactionActivityTitle({ direction, name, reaction: row.reaction, targetName })
    : direction === "received"
      ? `${name} ${engagementVerb(type, direction, targetName)}`
      : `You ${engagementVerb(type, direction, targetName)}`;

  return activityBase({
    id: `feed-post-${type.toLowerCase()}-${direction}-${row._id}`,
    type: `feed_post_${type.toLowerCase()}`,
    direction,
    filter: type === "SAVE" ? "saves" : type === "COMMENT" ? "comments" : "support",
    filterKeys: [type === "SAVE" ? "saves" : type === "COMMENT" ? "comments" : "support"],
    title,
    preview: type === "COMMENT" ? textPreview(row.text || target.preview) : target.preview,
    createdAt: engagementTime({ ...row, type }),
    actor,
    target,
    actionPath: `/posts/${post._id}`,
    canAcknowledge: direction === "received",
    metadata: { reaction: row.reaction || null },
  });
}

function feedPostEngagementActivities(posts, { direction, fanId }) {
  const fanKey = String(fanId);
  const belongsInDirection = (row) => {
    const rowUserId = String(row?.user?._id || row?.user || "");
    if (!rowUserId) return false;
    return direction === "sent" ? rowUserId === fanKey : rowUserId !== fanKey;
  };

  return posts.flatMap((post) => {
    const rows = [];
    for (const row of post.reactions || []) {
      if (belongsInDirection(row)) {
        rows.push(feedPostEngagementActivity(post, row, { direction, type: "REACTION" }));
      }
    }
    for (const row of post.comments || []) {
      if (row?.deletedAt) continue;
      if (belongsInDirection(row)) {
        rows.push(feedPostEngagementActivity(post, row, { direction, type: "COMMENT" }));
      }
    }
    for (const row of post.saves || []) {
      if (belongsInDirection(row)) {
        rows.push(feedPostEngagementActivity(post, row, { direction, type: "SAVE" }));
      }
    }
    return rows.filter(Boolean);
  });
}

function groupedSaveActivities(rows, { source }) {
  const groups = new Map();
  for (const row of rows) {
    const entity = source === "seen" ? row.publication : row.post;
    if (!entity) continue;
    const key = String(entity._id);
    const current = groups.get(key) || { rows: [], latest: row };
    current.rows.push(row);
    if (new Date(row.createdAt) > new Date(current.latest.createdAt)) current.latest = row;
    groups.set(key, current);
  }

  return [...groups.values()].map((group) => {
    if (group.rows.length === 1) return engagementActivity(group.latest, { direction: "received", source });
    const target = source === "seen" ? publicationTarget(group.latest.publication) : wallTarget(group.latest.post);
    const targetLabel = source === "seen" ? "Seen" : "note";
    return activityBase({
      id: `${source}-save-received-group-${target.id}`,
      type: `${source}_save_group`,
      direction: "received",
      filter: "saves",
      filterKeys: ["saves"],
      title: `${group.rows.length} people saved your ${targetLabel}`,
      preview: target.preview,
      createdAt: group.latest.createdAt,
      target,
      aggregate: { count: group.rows.length },
      actionPath: source === "seen" ? publicationRoute(group.latest.publication) : `/posts/${group.latest.post._id}`,
      canAcknowledge: false,
    });
  });
}

function directAccessActivity(window, fanId) {
  const asCreator = String(window.creator?._id || window.creator) === String(fanId);
  const other = asCreator ? window.fan : window.creator;
  const name = other?.name || other?.username || "Someone";
  return activityBase({
    id: `direct-access-${window._id}`,
    type: "direct_access",
    direction: asCreator ? "received" : "sent",
    filter: asCreator ? "support" : "purchases",
    filterKeys: [asCreator ? "support" : "purchases"],
    title: asCreator ? `${name} requested Direct Access` : `You opened Direct Access with ${name}`,
    preview: window.questionQuote || "",
    createdAt: window.openedAt || window.createdAt,
    actor: serializeCreator(other),
    actionPath: "/messages?tab=direct",
    reference: { type: "DIRECT_ACCESS_WINDOW", id: String(window._id) },
    dedupeKey: `da-open:${window._id}`,
    canAcknowledge: asCreator,
  });
}

function callActivity(call, fanId) {
  const incoming = String(call.recipient?._id || call.recipient) === String(fanId);
  const other = incoming ? call.caller : call.recipient;
  const name = other?.name || other?.username || "Someone";
  const minutes = Math.max(1, Math.round(Number(call.durationLimitSeconds || 0) / 60)) || 2;
  return activityBase({
    id: `call-${call._id}`,
    type: "paid_call",
    direction: incoming ? "received" : "sent",
    filter: incoming ? "support" : "purchases",
    filterKeys: [incoming ? "support" : "purchases"],
    title: incoming ? `${name} requested a ${minutes}-minute call` : `You requested a ${minutes}-minute call with ${name}`,
    createdAt: call.createdAt,
    actor: serializeCreator(other),
    actionPath: "/messages",
    reference: { type: "PAID_CALL", id: String(call._id) },
    dedupeKey: `paid-call:${call._id}`,
    canAcknowledge: incoming,
  });
}

function isExpiringSoon(subscription) {
  const nextRenewalAt = subscription.nextRenewalAt || subscription.expiresAt;

  if (!nextRenewalAt || subscription.status !== "active") {
    return false;
  }

  const renewalDate = new Date(nextRenewalAt).getTime();
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  return renewalDate >= now && renewalDate <= now + sevenDays;
}

function serializeSubscription(subscription) {
  return {
    id: subscription._id,
    creator: serializeCreator(subscription.creator),
    status: subscription.status || "pending",
    startDate: subscription.startedAt || subscription.createdAt,
    nextRenewalDate: subscription.nextRenewalAt || null,
    expiresAt: subscription.expiresAt || null,
    priceCents: subscription.priceCents ?? null,
    trialStatus: subscription.trialStatus || null,
    gracePeriod: Boolean(subscription.gracePeriod),
    autoRenew: subscription.autoRenew ?? null,
    isExpiringSoon: isExpiringSoon(subscription),
  };
}

function transactionDirection(transaction) {
  if (transaction.type === "debit") {
    return "debit";
  }

  if (transaction.type === "credit") {
    return "credit";
  }

  return Number(transaction.amount) < 0 ? "debit" : "credit";
}

function serializeTransaction(transaction) {
  const direction = transactionDirection(transaction);

  return {
    id: transaction._id,
    type: transaction.type || direction,
    description: transaction.description || (direction === "credit" ? "Coin balance credit" : "Coin balance debit"),
    amount: Math.abs(Number(transaction.amount) || 0),
    direction,
    status: transaction.status || "pending",
    relatedCreator: serializeCreator(transaction.creator),
    relatedContent: transaction.content
      ? {
          title: transaction.content.title,
          type: transaction.content.contentType || "content",
        }
      : null,
    createdAt: transaction.createdAt,
  };
}

function messagePreview(message) {
  if (message.deletedAt) {
    return "Message unavailable";
  }

  if (message.mediaType === "image") {
    return "Sent an image";
  }

  if (message.mediaType === "video") {
    return "Sent a video";
  }

  if (message.mediaType === "audio") {
    return "Sent an audio message";
  }

  return String(message.body || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

async function getRecentConversations(fanId, limit = DEFAULT_LIMITS.dashboardConversations) {
  const messages = await Message.find({
    $or: [{ sender: fanId }, { recipient: fanId }],
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate("sender", "name username avatar role status")
    .populate("recipient", "name username avatar role status")
    .lean();

  const conversations = [];
  const seen = new Set();
  const fanKey = fanId.toString();

  for (const message of messages) {
    const senderId = message.sender?._id?.toString();
    const otherUser = senderId === fanKey ? message.recipient : message.sender;

    if (!otherUser || otherUser.role !== "creator" || otherUser.status !== "active") {
      continue;
    }

    const otherKey = otherUser._id.toString();

    if (seen.has(otherKey)) {
      continue;
    }

    seen.add(otherKey);
    conversations.push({
      id: otherKey,
      creator: serializeCreator(otherUser),
      lastMessagePreview: messagePreview(message),
      lastMessageAt: message.createdAt,
      unread: false,
      ppm: Boolean(message.ppm),
    });

    if (conversations.length >= limit) {
      break;
    }
  }

  return conversations;
}

async function getDashboardSubscriptions(fanId) {
  const subscriptions = await Subscription.find({
    fan: fanId,
    status: { $in: ["active", "grace_period"] },
  })
    .sort({ nextRenewalAt: 1, updatedAt: -1, createdAt: -1 })
    .limit(DEFAULT_LIMITS.dashboardSubscriptions)
    .populate("creator", "name username avatar status")
    .lean();

  return subscriptions
    .filter((subscription) => subscription.creator?.status !== "suspended")
    .map(serializeSubscription);
}

function serializeActivityItem(item) {
  return {
    id: item.id,
    type: item.type,
    description: item.description,
    title: item.title || item.description,
    preview: item.preview || "",
    createdAt: item.createdAt,
    relatedCreator: item.relatedCreator || null,
    relatedContent: item.relatedContent || null,
    actionPath: item.actionPath || null,
    route: item.route || item.actionPath || null,
    direction: item.direction || null,
    filter: item.filter || null,
    filterKeys: item.filterKeys || null,
    actor: item.actor || null,
    target: item.target || null,
    amount: item.amount || null,
    currency: item.currency || null,
    aggregate: item.aggregate || null,
    starsChange: item.starsChange ?? null,
    canAcknowledge: item.canAcknowledge ?? true,
    acknowledged: Boolean(item.acknowledged),
    read: Boolean(item.read),
    warningId: item.warningId || null,
    severity: item.severity || null,
    priority: item.priority || 0,
    event: item.event || null,
    reference: item.reference || null,
    dedupeKey: item.dedupeKey || null,
    metadata: item.metadata || {},
  };
}

const ACTIVITY_FILTER_ALIASES = {
  all: "all",
  seen: "seen",
  support: "support",
  saves: "saves",
  comments: "comments",
  follows: "follows",
  earnings: "earnings",
  purchases: "purchases",
};

function normalizeActivityDirection(value) {
  return value === "sent" ? "sent" : value === "received" ? "received" : null;
}

function normalizeActivityFilter(value) {
  return ACTIVITY_FILTER_ALIASES[value] || "all";
}

function filterActivityItems(items, { direction, filter }) {
  return items.filter((item) => {
    const matchesDirection = !direction || item.direction === direction;
    const keys = Array.isArray(item.filterKeys) ? item.filterKeys : [item.filter].filter(Boolean);
    const matchesFilter = filter === "all" || item.filter === filter || keys.includes(filter);
    return matchesDirection && matchesFilter;
  });
}

function unreadActivityCount(items) {
  return items.filter((item) => item.direction === "received" && item.canAcknowledge && !item.acknowledged && !item.read).length;
}

async function getActivity(fanId, wallet, limit = DEFAULT_LIMITS.dashboardActivity) {
  const [
    subscriptions,
    notifications,
    transactions,
    messages,
    receivedFollows,
    sentFollows,
    receivedSeeSignals,
    sentSeeSignals,
    receivedSeenEngagements,
    sentSeenEngagements,
    receivedWallEngagements,
    sentWallEngagements,
    receivedWallShareEngagements,
    receivedFeedPostEngagementPosts,
    sentFeedPostEngagementPosts,
    directAccessWindows,
    callSessions,
  ] = await Promise.all([
    Subscription.find({ fan: fanId }).sort({ updatedAt: -1 }).limit(limit).populate("creator", "name username avatar").lean(),
    Notification.find({ user: fanId }).sort({ createdAt: -1 }).limit(limit).lean(),
    wallet
      ? Transaction.find({ wallet: wallet._id }).sort({ createdAt: -1 }).limit(limit).lean()
      : Promise.resolve([]),
    Message.find({ recipient: fanId }).sort({ createdAt: -1 }).limit(limit).populate("sender", "name username avatar role status").lean(),
    ProfileRelationship.find({ target: fanId, type: "FOLLOW" }).sort({ createdAt: -1 }).limit(limit).populate("actor", "name username avatar role status").lean(),
    ProfileRelationship.find({ actor: fanId, type: "FOLLOW" }).sort({ createdAt: -1 }).limit(limit).populate("target", "name username avatar role status").lean(),
    OrbitSignal.find({ targetUser: fanId, type: "SEE_YOU", status: "active" }).sort({ createdAt: -1 }).limit(limit).populate({ path: "sender", match: { status: "active" }, select: "name username avatar role status" }).lean(),
    OrbitSignal.find({ sender: fanId, type: "SEE_YOU", status: "active" }).sort({ createdAt: -1 }).limit(limit).populate({ path: "targetUser", match: { status: "active" }, select: "name username avatar role status" }).lean(),
    SeenEngagement.find({ user: { $ne: fanId }, type: { $in: ["REACTION", "COMMENT", "SAVE", "SHARE"] } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit * 6).populate("user", "name username avatar role status").populate({ path: "publication", match: { creator: fanId, status: "PUBLISHED" }, select: "title summary description kind creator publishedSnapshot.metadata.title" }).lean(),
    SeenEngagement.find({ user: fanId, type: { $in: ["REACTION", "COMMENT", "SAVE", "SHARE"] } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).populate({ path: "publication", match: { status: "PUBLISHED" }, select: "title summary description kind creator publishedSnapshot.metadata.title", populate: { path: "creator", select: "name username avatar role status" } }).lean(),
    WallEngagement.find({ user: { $ne: fanId }, type: { $in: ["REACTION", "COMMENT", "SAVE", "SHARE"] } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit * 6).populate("user", "name username avatar role status").populate({ path: "post", match: { creator: fanId, status: "PUBLISHED" }, select: "text creator" }).lean(),
    WallEngagement.find({ user: fanId, type: { $in: ["REACTION", "COMMENT", "SAVE", "SHARE"] } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).populate({ path: "post", match: { status: "PUBLISHED" }, select: "text creator", populate: { path: "creator", select: "name username avatar role status" } }).lean(),
    WallShareEngagement.find({ user: { $ne: fanId }, type: { $in: ["REACTION", "COMMENT", "SAVE"] } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit * 6).populate("user", "name username avatar role status").populate({ path: "share", match: { user: fanId, type: "SHARE" }, select: "post user text createdAt updatedAt", populate: { path: "post", match: { status: "PUBLISHED" }, select: "text creator" } }).lean(),
    FeedPost.find({
      author: fanId,
      status: "published",
      deletedAt: null,
      $or: [
        { reactions: { $elemMatch: { user: { $ne: fanId } } } },
        { comments: { $elemMatch: { user: { $ne: fanId }, deletedAt: null } } },
        { saves: { $elemMatch: { user: { $ne: fanId } } } },
      ],
    }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit * 4).populate("author", "name username avatar role status").populate("reactions.user", "name username avatar role status").populate("comments.user", "name username avatar role status").populate("saves.user", "name username avatar role status").lean(),
    FeedPost.find({
      status: "published",
      deletedAt: null,
      author: { $ne: fanId },
      $or: [
        { reactions: { $elemMatch: { user: fanId } } },
        { comments: { $elemMatch: { user: fanId, deletedAt: null } } },
        { saves: { $elemMatch: { user: fanId } } },
      ],
    }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit * 4).populate("author", "name username avatar role status").populate("reactions.user", "name username avatar role status").populate("comments.user", "name username avatar role status").populate("saves.user", "name username avatar role status").lean(),
    DAWindow.find({ $or: [{ creator: fanId }, { fan: fanId }] }).sort({ createdAt: -1 }).limit(limit).populate("fan creator", "name username avatar role status").lean(),
    CallSession.find({ $or: [{ recipient: fanId }, { caller: fanId }] }).sort({ createdAt: -1 }).limit(limit).populate("caller recipient", "name username avatar role status").lean(),
  ]);

  const receivedShareRows = receivedWallShareEngagements
    .filter((row) => row.user && row.share?.post)
    .map((row) => ({ ...row, post: row.share.post }));
  const receivedSeenSaves = receivedSeenEngagements.filter((row) => row.type === "SAVE");
  const receivedWallSaves = [...receivedWallEngagements, ...receivedShareRows].filter((row) => row.type === "SAVE");
  const directAccessWindowIds = directAccessWindows.map((window) => window._id);
  const directAccessQuestions = directAccessWindowIds.length
    ? await Message.find({
        directAccessWindow: { $in: directAccessWindowIds },
        messageKind: "USER_MESSAGE",
      }).sort({ createdAt: 1 }).select("directAccessWindow sender body").lean()
    : [];
  const directAccessQuestionByWindow = new Map();
  for (const message of directAccessQuestions) {
    const key = String(message.directAccessWindow);
    if (!directAccessQuestionByWindow.has(key)) directAccessQuestionByWindow.set(key, textPreview(message.body, 120));
  }
  const activity = [
    ...receivedFollows.filter((row) => row.actor?.status !== "suspended").map((row) => followActivity(row, "received")),
    ...sentFollows.filter((row) => row.target?.status !== "suspended").map((row) => followActivity(row, "sent")),
    ...receivedSeeSignals.filter((signal) => signal.sender).map((signal) => orbitActivity(signal, "received")),
    ...sentSeeSignals.filter((signal) => signal.targetUser).map((signal) => orbitActivity(signal, "sent")),
    ...groupedSaveActivities(receivedSeenSaves, { source: "seen" }),
    ...groupedSaveActivities(receivedWallSaves, { source: "wall" }),
    ...receivedSeenEngagements.filter((row) => row.type !== "SAVE" && row.user && row.publication).map((row) => engagementActivity(row, { direction: "received", source: "seen" })).filter(Boolean),
    ...[...receivedWallEngagements, ...receivedShareRows].filter((row) => row.type !== "SAVE" && row.user && row.post).map((row) => engagementActivity(row, { direction: "received", source: "wall" })).filter(Boolean),
    ...sentSeenEngagements.filter((row) => row.publication).map((row) => engagementActivity(row, { direction: "sent", source: "seen" })).filter(Boolean),
    ...sentWallEngagements.filter((row) => row.post).map((row) => engagementActivity(row, { direction: "sent", source: "wall" })).filter(Boolean),
    ...feedPostEngagementActivities(receivedFeedPostEngagementPosts, { direction: "received", fanId }),
    ...feedPostEngagementActivities(sentFeedPostEngagementPosts, { direction: "sent", fanId }),
    ...directAccessWindows.map((window) => directAccessActivity({ ...window, questionQuote: directAccessQuestionByWindow.get(String(window._id)) || "" }, fanId)),
    ...callSessions.map((call) => callActivity(call, fanId)),
    ...subscriptions.map((subscription) => activityBase({
      id: `subscription-${subscription._id}`,
      type: "subscription",
      direction: "sent",
      filter: "purchases",
      filterKeys: ["purchases"],
      title:
        subscription.status === "active"
          ? `Subscribed to ${subscription.creator?.name || "a creator"}`
          : `Subscription ${subscription.status || "updated"}`,
      createdAt: subscription.updatedAt || subscription.createdAt,
      actor: serializeCreator(subscription.creator),
      actionPath: "/memberships",
      canAcknowledge: false,
    })),
    ...transactions.map(transactionActivity),
    ...messages
      .filter((message) => message.sender?.role === "creator" && message.sender?.status === "active")
      .map((message) => activityBase({
        id: `message-${message._id}`,
        type: "message",
        direction: "received",
        filter: "comments",
        filterKeys: ["comments"],
        title: `Received a creator reply from ${message.sender?.name || "a creator"}`,
        preview: messagePreview(message),
        createdAt: message.createdAt,
        actor: serializeCreator(message.sender),
        actionPath: "/messages",
      })),
    ...notifications.map(notificationActivity),
  ];

  const seenDedupe = new Set();
  return activity
    .filter((item) => {
      const key = item.dedupeKey || item.id;
      if (!key) return true;
      if (seenDedupe.has(key)) return false;
      seenDedupe.add(key);
      return true;
    })
    .sort((left, right) => (new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()) || (Number(right.priority) - Number(left.priority)))
    .slice(0, limit)
    .map(serializeActivityItem);
}

async function getWalletData(fanId, transactionLimit = DEFAULT_LIMITS.pageSize) {
  const wallet = await Wallet.findOne({ user: fanId }).lean();
  const transactions = wallet
    ? await Transaction.find({ wallet: wallet._id })
        .sort({ createdAt: -1 })
        .limit(transactionLimit)
        .populate("creator", "name username avatar")
        .populate("content", "title contentType")
        .lean()
    : [];

  return {
    wallet,
    walletData: {
      balance: wallet?.balance || 0,
      currency: wallet?.currency || "COINS",
      recentTransactions: transactions.map(serializeTransaction),
      summary: {
        availableBalance: wallet?.balance || 0,
        totalPurchased: transactions
          .filter((transaction) => transactionDirection(transaction) === "credit" && transaction.status === "completed")
          .reduce((total, transaction) => total + Math.abs(Number(transaction.amount) || 0), 0),
        totalSpent: transactions
          .filter((transaction) => transactionDirection(transaction) === "debit" && transaction.status === "completed")
          .reduce((total, transaction) => total + Math.abs(Number(transaction.amount) || 0), 0),
        recentTransactionCount: transactions.length,
      },
    },
  };
}

async function getSubscriptions(fanId, limit = DEFAULT_LIMITS.pageSize) {
  const subscriptions = await Subscription.find({ fan: fanId })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit)
    .populate("creator", "name username avatar status")
    .lean();

  return subscriptions
    .filter((subscription) => subscription.creator?.status !== "suspended")
    .map(serializeSubscription);
}

function filterSubscriptions(subscriptions, status) {
  if (!status || status === "all") {
    return subscriptions;
  }

  if (status === "expiringSoon") {
    return subscriptions.filter((subscription) => subscription.isExpiringSoon);
  }

  return subscriptions.filter((subscription) => subscription.status === status);
}

function subscriptionSummary(subscriptions) {
  return {
    active: subscriptions.filter((subscription) => subscription.status === "active").length,
    expiringSoon: subscriptions.filter((subscription) => subscription.isExpiringSoon).length,
    cancelledOrExpired: subscriptions.filter((subscription) => ["cancelled", "expired"].includes(subscription.status)).length,
    monthlySpendCents: null,
  };
}

function emptyPurchases() {
  return {
    items: [],
    summary: {
      total: 0,
    },
  };
}

export const getFanDashboard = asyncHandler(async (req, res) => {
  const fanId = req.user._id;
  const [profile, subscriptions, walletResult, conversations] = await Promise.all([
    ensureFanProfile(fanId),
    getDashboardSubscriptions(fanId),
    getWalletData(fanId, DEFAULT_LIMITS.dashboardTransactions),
    getRecentConversations(fanId, DEFAULT_LIMITS.dashboardConversations),
  ]);
  const activeSubscriptionCount = await Subscription.countDocuments({
    fan: fanId,
    status: { $in: ["active", "grace_period"] },
  });
  const recentActivity = await getActivity(fanId, walletResult.wallet, DEFAULT_LIMITS.dashboardActivity);

  return sendResponse(res, 200, "Fan dashboard fetched", {
    profile: serializeProfile(req.user, profile),
    summary: {
      activeSubscriptions: activeSubscriptionCount,
      coinBalance: walletResult.walletData.balance,
      purchasedContentCount: 0,
      unreadMessages: 0,
    },
    subscriptions,
    wallet: walletResult.walletData,
    purchasedContent: [],
    messages: {
      unreadCount: 0,
      recentConversations: conversations,
    },
    recentActivity,
    capabilities: {
      discoverCreators: true,
      coinPurchase: false,
      subscriptionManagement: false,
      purchasedContent: false,
      realtimeMessages: false,
    },
  });
});

export const getFanSubscriptions = asyncHandler(async (req, res) => {
  const subscriptions = await getSubscriptions(req.user._id, limitFromQuery(req.query.limit));
  const filteredSubscriptions = filterSubscriptions(subscriptions, req.query.status);

  return sendResponse(res, 200, "Fan subscriptions fetched", {
    summary: subscriptionSummary(subscriptions),
    subscriptions: filteredSubscriptions,
  });
});

export const getFanWallet = asyncHandler(async (req, res) => {
  const { walletData } = await getWalletData(req.user._id, limitFromQuery(req.query.limit));

  return sendResponse(res, 200, "Fan wallet fetched", {
    wallet: walletData,
  });
});

export const getFanPurchases = asyncHandler(async (_req, res) => {
  return sendResponse(res, 200, "Fan purchased content fetched", emptyPurchases());
});

export const getFanMessages = asyncHandler(async (req, res) => {
  const conversations = await getRecentConversations(req.user._id, limitFromQuery(req.query.limit));

  return sendResponse(res, 200, "Fan messages fetched", {
    unreadCount: 0,
    recentConversations: conversations,
  });
});

export const getFanActivity = asyncHandler(async (req, res) => {
  const wallet = await Wallet.findOne({ user: req.user._id }).lean();
  const direction = normalizeActivityDirection(req.query.direction);
  const filter = normalizeActivityFilter(req.query.filter || req.query.type);
  const requestedLimit = limitFromQuery(req.query.limit, 30);
  const page = Math.max(1, Number(req.query.page) || 1);
  const queryLimit = Math.min(100, Math.max(requestedLimit * page + 1, requestedLimit + 1));
  const allActivity = await getActivity(req.user._id, wallet, queryLimit);
  const filteredActivity = filterActivityItems(allActivity, { direction, filter });
  const activity = filteredActivity.slice(0, requestedLimit * page);

  return sendResponse(res, 200, "Fan activity fetched", {
    activity,
    items: activity,
    unreadCount: unreadActivityCount(allActivity),
    pageInfo: {
      page,
      limit: requestedLimit,
      hasMore: filteredActivity.length > activity.length,
      nextPage: filteredActivity.length > activity.length ? page + 1 : null,
    },
  });
});

export const acknowledgeFanActivity = asyncHandler(async (req, res) => {
  const activityId = String(req.params.activityId || "");
  const acknowledgedAt = new Date();

  if (activityId.startsWith("notification-")) {
    const notificationId = activityId.replace("notification-", "");
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, user: req.user._id },
      { $set: { acknowledgedAt, readAt: acknowledgedAt } },
      { new: true },
    ).lean();

    return sendResponse(res, notification ? 200 : 404, notification ? "Activity acknowledged" : "Activity not found", {
      acknowledged: Boolean(notification),
      acknowledgedAt: notification?.acknowledgedAt || null,
    });
  }

  if (activityId.startsWith("profile-see-received-")) {
    const signalId = activityId.replace("profile-see-received-", "");
    const signal = await OrbitSignal.findOneAndUpdate(
      { _id: signalId, targetUser: req.user._id, type: "SEE_YOU", status: "active" },
      { $set: { acknowledgedAt } },
      { new: true },
    ).lean();

    return sendResponse(res, signal ? 200 : 404, signal ? "Activity acknowledged" : "Activity not found", {
      acknowledged: Boolean(signal),
      acknowledgedAt: signal?.acknowledgedAt || null,
    });
  }

  return sendResponse(res, 422, "Activity acknowledgement is not supported for this item", {
    acknowledged: false,
  });
});

export const getFanContentAccess = asyncHandler(async (req, res) => {
  const content = await Content.findOne({ _id: req.params.contentId, status: "published" }).select("_id").lean();

  return sendResponse(res, content ? 403 : 404, content ? "Content access is not available for this fan" : "Content not found");
});

export const fanDashboardTestUtils = {
  activityBase,
  directAccessActivity,
  engagementActivity,
  engagementTime,
  feedPostEngagementActivities,
  filterSubscriptions,
  followActivity,
  filterActivityItems,
  groupedSaveActivities,
  isExpiringSoon,
  messagePreview,
  notificationActivity,
  normalizeActivityDirection,
  normalizeActivityFilter,
  unreadActivityCount,
  orbitActivity,
  profileCompletion,
  subscriptionSummary,
  transactionDirection,
};
