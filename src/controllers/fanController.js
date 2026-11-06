import Content from "../models/Content.js";
import Publication from "../models/Publication.js";
import CallSession from "../models/CallSession.js";
import DAWindow from "../models/DAWindow.js";
import FanProfile from "../models/FanProfile.js";
import FeedPost from "../models/FeedPost.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import Story from "../models/Story.js";
import User from "../models/User.js";
import { storyAudiencesFor } from "../services/storyAudienceService.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import Subscription from "../models/Subscription.js";
import Transaction from "../models/Transaction.js";
import Wallet from "../models/Wallet.js";
import SeenEngagement from "../models/SeenEngagement.js";
import WallEngagement from "../models/WallEngagement.js";
import WallShareEngagement from "../models/WallShareEngagement.js";
import OrbitSignal from "../models/OrbitSignal.js";
import ActivityAcknowledgement from "../models/ActivityAcknowledgement.js";
import ChatGift from "../models/ChatGift.js";
import DreamGift from "../models/DreamGift.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { supplementalActivity } from "../services/activitySupplementService.js";

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
  const cover = publication.publishedSnapshot?.metadata?.coverMedia || publication.coverMedia || publication.introMedia;
  return {
    id: String(publication._id),
    type: publication.kind || "SEEN",
    title: publicationTitle(publication),
    preview: textPreview(publication.summary || publication.description || publicationTitle(publication)),
    ...(cover?.secureUrl ? cover.resourceType === "video" || cover.mediaType === "VIDEO" ? { videoUrl: cover.secureUrl } : { imageUrl: cover.secureUrl } : {}),
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

function notificationActivity(notification, giftThanksByKey = new Map()) {
  if (notification.type === "seen_owner_thanks" && notification.target?.id) {
    const metadata = notification.metadata || {};
    return activityBase({
      id: `notification-${notification._id}`,
      type: notification.type,
      filter: "support",
      filterKeys: ["support"],
      title: notification.title,
      preview: notification.message,
      createdAt: notification.createdAt,
      actor: notification.actor?._id ? serializeCreator(notification.actor) : null,
      target: { ...notification.target, ...(metadata.cover || {}) },
      actionPath: `/seen/${notification.target.id}`,
      metadata,
      acknowledged: Boolean(notification.acknowledgedAt || notification.readAt),
      read: Boolean(notification.readAt),
      canAcknowledge: true,
    });
  }
  if (notification.type === "publication_tag" && notification.target?.id) {
    return activityBase({ id: `notification-${notification._id}`, type: notification.type, filter: "mentions", title: notification.title, preview: notification.message, createdAt: notification.createdAt, actor: notification.actor?._id ? serializeCreator(notification.actor) : null, target: { ...notification.target, ...notification.metadata?.cover }, actionPath: `/seen/${notification.target.id}`, canAcknowledge: true, acknowledged: Boolean(notification.readAt || notification.acknowledgedAt) });
  }
  if (/^premium_renewal|^premium_membership_cancelled$|^membership_cancelled$|^publication_chapter_added$/.test(notification.type || "")) {
    const metadata = notification.metadata || {};
    const worldId = notification.target?.id || metadata.publicationId;
    const lowBalance = /low_balance|failed/.test(notification.type);
    return activityBase({ id: `notification-${notification._id}`, type: notification.type, filter: "subscriptions", filterKeys: ["subscriptions"], title: notification.title, preview: notification.message, createdAt: notification.createdAt, actor: notification.actor?._id ? serializeCreator(notification.actor) : null, target: worldId ? { type: notification.target?.type || "PREMIUM_WORLD", id: String(worldId), ...metadata.cover } : null, metadata, actionPath: lowBalance ? "/wallet" : worldId ? `${notification.target?.type === "SEEN" || notification.target?.type === "EXPERIENCE" ? "/seen" : "/world"}/${worldId}` : "/memberships", canAcknowledge: true, acknowledged: Boolean(notification.readAt || notification.acknowledgedAt), read: Boolean(notification.readAt) });
  }
  if (/^direct_access_(answered|refunded)$/.test(notification.type || "") && notification.metadata?.windowId) {
    const metadata = notification.metadata;
    return activityBase({ id: `notification-${notification._id}`, type: notification.type, filter: notification.type.endsWith("refunded") ? "purchases" : "comments", title: notification.title, createdAt: notification.createdAt, actor: notification.actor?._id ? serializeCreator(notification.actor) : null, metadata, actionPath: `/messages?tab=direct&with=${metadata.creatorId}&window=${metadata.windowId}`, canAcknowledge: true, acknowledged: Boolean(notification.readAt || notification.acknowledgedAt) });
  }
  if (notification.target?.type === "STORY" && notification.target.id) {
    const reply = notification.type === "story_reply";
    const sentMention = notification.type === "story_mention_sent";
    const mention = sentMention || notification.type === "story_mention";
    const target = { ...notification.target, id: String(notification.target.id) };
    const query = new URLSearchParams({ with: String(target.conversationUserId || "") });
    if (target.messageId) query.set("message", String(target.messageId));
    return activityBase({
      id: `notification-${notification._id}`, type: notification.type, direction: sentMention ? "sent" : "received",
      filter: mention ? "mentions" : reply ? "comments" : notification.type === "story_reaction" ? "support" : "other",
      title: notification.title, preview: notification.message, createdAt: notification.createdAt,
      actor: notification.actor?._id ? serializeCreator(notification.actor) : null, target,
      actionPath: reply && target.conversationUserId ? `/messages?${query}` : `/stories/${target.id}`,
      metadata: notification.metadata || {}, dedupeKey: notification.dedupeKey,
      acknowledged: Boolean(notification.acknowledgedAt || notification.readAt), read: Boolean(notification.readAt), canAcknowledge: !sentMention,
    });
  }
  const isWarning = notification.type === "moderation_warning";
  const systemTitle = /react/i.test(notification.type || "") ? notification.title : String(notification.title || "").replace(/\p{Extended_Pictographic}[\uFE0F\u200D]?/gu, "").replace(/\s{2,}/g, " ").trim();
  const giftThanks = notification.type === "gift_thanks" ? giftThanksByKey.get(notification.dedupeKey) : null;
  const financial = /earning|refund|wallet|stars|debit|credit/i.test(`${notification.type} ${notification.title}`);
  const filter = isWarning ? "moderation" : giftThanks ? "support" : financial ? "earnings" : "system";

  if (giftThanks) {
    const creator = giftThanks.kind === "dream" ? giftThanks.gift.creator : giftThanks.gift.recipient;
    const name = creator?.name || creator?.username || "Someone";
    return activityBase({
      id: `notification-${notification._id}`,
      type: "gift_thanks",
      direction: "received",
      filter: "support",
      filterKeys: ["support"],
      title: `${name} thanked you for your gift`,
      description: `${name} thanked you for your gift`,
      preview: notification.message || "Thank you — I saw it right away.",
      createdAt: notification.createdAt,
      actor: serializeCreator(creator),
      actionPath: creator?.username ? `/profile/${encodeURIComponent(creator.username)}` : null,
      acknowledged: Boolean(notification.acknowledgedAt || notification.readAt),
      read: Boolean(notification.readAt),
      dedupeKey: notification.dedupeKey,
      canAcknowledge: true,
      reference: { type: giftThanks.kind === "dream" ? "DREAM_GIFT" : "CHAT_GIFT", id: String(giftThanks.gift._id) },
      metadata: {
        giftId: String(giftThanks.gift.gift || giftThanks.gift._id),
        giftImageUrl: giftThanks.gift.giftImageUrl || "",
        giftName: giftThanks.gift.giftName || "Gift",
        giftSource: giftThanks.kind === "dream" ? "Dream" : (giftThanks.gift.sourceType === "STORY" ? "Story" : "Direct"),
      },
    });
  }

  return activityBase({
    id: `notification-${notification._id}`,
    warningId: isWarning ? String(notification._id) : null,
    type: notification.type || "notification",
    direction: "received",
    filter,
    filterKeys: filter === "moderation" ? ["system"] : [filter],
    title: systemTitle,
    description: isWarning ? (notification.message || systemTitle) : systemTitle,
    preview: isWarning ? notification.message : notification.message,
    severity: notification.severity,
    priority: notification.priority || 0,
    acknowledged: Boolean(notification.acknowledgedAt || notification.readAt),
    read: Boolean(notification.readAt),
    createdAt: notification.createdAt,
    actionPath: notification.metadata?.appealUrl || (isWarning ? "/settings/support/safety" : notification.type === "membership_cancelled" ? "/memberships" : null),
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
    const saves = (post.saves || []).filter(belongsInDirection);
    if (direction === "received") rows.push(...groupedSaveActivities(saves.map(row => ({ ...row, post })), { source: "wall" }));
    else for (const row of saves) rows.push(feedPostEngagementActivity(post, row, { direction, type: "SAVE" }));
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
    if (new Date(engagementTime(row)) > new Date(engagementTime(current.latest))) current.latest = row;
    groups.set(key, current);
  }

  return [...groups.values()].map((group) => {
    if (group.rows.length === 1 && source === "seen") return engagementActivity(group.latest, { direction: "received", source });
    const count = new Set(group.rows.map(row => String(row.user?._id || row.user || row._id))).size;
    const target = source === "seen" ? publicationTarget(group.latest.publication) : wallTarget(group.latest.post);
    const targetLabel = source === "seen" ? "Seen" : "note";
    return activityBase({
      id: `${source}-save-received-group-${target.id}`,
      type: `${source}_save_group`,
      direction: "received",
      filter: "saves",
      filterKeys: ["saves"],
      title: `${count} ${count === 1 ? "person" : "people"} saved your ${targetLabel}`,
      preview: target.preview,
      createdAt: engagementTime(group.latest),
      target,
      aggregate: { count },
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
    actionPath: `/messages?tab=direct&with=${other?._id || other}&window=${window._id}`,
    metadata: { canAnswer: asCreator && window.status === "OPEN" && new Date(window.expiresAt) > new Date(), windowId: String(window._id) },
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
  mentions: "mentions",
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

function giftActivity(gift, direction, source) {
  const received = direction === "received";
  const person = received ? gift.sender || gift.supporter : gift.recipient || gift.creator;
  const privateDream = source === "Dream" && received && gift.privateSupport;
  const actor = privateDream ? null : serializeCreator(person);
  const name = privateDream ? "Someone" : person?.name || person?.username || "Someone";
  const giftName = gift.giftName || "a gift";
  return activityBase({
    id: `gift-${direction}-${gift._id}`,
    type: "gift",
    direction,
    filter: "support",
    filterKeys: ["support", received ? "earnings" : "purchases"],
    title: received ? `${name} sent you ${giftName}` : `You sent ${giftName} to ${name}`,
    preview: source === "Dream" && gift.dream?.title ? gift.dream.title : "",
    createdAt: gift.createdAt,
    actor,
    actionPath: person?.username ? `/profile/${encodeURIComponent(person.username)}` : null,
    starsChange: (received ? 1 : -1) * Number(gift.starsAmount || 0),
    event: `${source.toUpperCase()}_GIFT`,
    reference: { type: source === "Dream" ? "DREAM_GIFT" : "CHAT_GIFT", id: String(gift._id) },
    metadata: { giftName, giftSource: source, giftImageUrl: gift.giftImageUrl || "" },
    dedupeKey: `${source.toLowerCase()}-gift:${gift._id}`,
    canAcknowledge: received,
  });
}

const acknowledgementKey = (activityId) => String(activityId || "")
  .replace("-received-", "-interaction-")
  .replace("-sent-", "-interaction-");

async function applyAcknowledgements(items) {
  const keys = [...new Set(items.map((item) => acknowledgementKey(item.id)))];
  const receipts = keys.length ? await ActivityAcknowledgement.find({ eventKey: { $in: keys } }).select("eventKey acknowledgedAt").lean() : [];
  const byKey = new Map(receipts.map((receipt) => [receipt.eventKey, receipt.acknowledgedAt]));
  return items.map((item) => {
    const acknowledgedAt = byKey.get(acknowledgementKey(item.id));
    return acknowledgedAt ? { ...item, acknowledged: true, acknowledgedAt } : item;
  });
}

async function getActivity(fanId, wallet, limit = DEFAULT_LIMITS.dashboardActivity, { truncate = true } = {}) {
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
    receivedChatGifts,
    sentChatGifts,
    receivedDreamGifts,
    sentDreamGifts,
  ] = await Promise.all([
    Subscription.find({ fan: fanId }).sort({ updatedAt: -1 }).limit(limit).populate("creator", "name username avatar").lean(),
    Notification.find({ user: fanId }).sort({ createdAt: -1 }).limit(limit).populate("actor", "name username avatar status").lean(),
    wallet
      ? Transaction.find({ wallet: wallet._id }).sort({ createdAt: -1 }).limit(limit).lean()
      : Promise.resolve([]),
    Message.find({ recipient: fanId }).sort({ createdAt: -1 }).limit(limit).populate("sender", "name username avatar role status").lean(),
    ProfileRelationship.find({ target: fanId, type: "FOLLOW" }).sort({ createdAt: -1 }).limit(limit).populate("actor", "name username avatar role status").lean(),
    ProfileRelationship.find({ actor: fanId, type: "FOLLOW" }).sort({ createdAt: -1 }).limit(limit).populate("target", "name username avatar role status").lean(),
    OrbitSignal.find({ targetUser: fanId, type: "SEE_YOU", status: "active" }).sort({ createdAt: -1 }).limit(limit).populate({ path: "sender", match: { status: "active" }, select: "name username avatar role status" }).lean(),
    OrbitSignal.find({ sender: fanId, type: "SEE_YOU", status: "active" }).sort({ createdAt: -1 }).limit(limit).populate({ path: "targetUser", match: { status: "active" }, select: "name username avatar role status" }).lean(),
    SeenEngagement.find({ user: { $ne: fanId }, type: { $in: ["REACTION", "COMMENT", "SAVE", "SHARE"] } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit * 6).populate("user", "name username avatar role status").populate({ path: "publication", match: { creator: fanId, status: "PUBLISHED" }, select: "title summary description kind creator coverMedia introMedia publishedSnapshot.metadata.title publishedSnapshot.metadata.coverMedia" }).lean(),
    SeenEngagement.find({ user: fanId, type: { $in: ["REACTION", "COMMENT", "SAVE", "SHARE"] } }).sort({ updatedAt: -1, createdAt: -1 }).limit(limit).populate({ path: "publication", match: { status: "PUBLISHED" }, select: "title summary description kind creator coverMedia introMedia publishedSnapshot.metadata.title publishedSnapshot.metadata.coverMedia", populate: { path: "creator", select: "name username avatar role status" } }).lean(),
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
    ChatGift.find({ recipient: fanId }).sort({ createdAt: -1 }).limit(limit).populate("sender", "name username avatar role status").lean(),
    ChatGift.find({ sender: fanId }).sort({ createdAt: -1 }).limit(limit).populate("recipient", "name username avatar role status").lean(),
    DreamGift.find({ creator: fanId }).sort({ createdAt: -1 }).limit(limit).populate("supporter", "name username avatar role status").populate("dream", "title").lean(),
    DreamGift.find({ supporter: fanId }).sort({ createdAt: -1 }).limit(limit).populate("creator", "name username avatar role status").populate("dream", "title").lean(),
  ]);

  // Resolve previews at read time; old notifications must not expose expired or restricted media.
  for (const notification of notifications) {
    if (["publication_tag", "publication_chapter_added"].includes(notification.type)) {
      const publication = await Publication.findById(notification.target?.id).select("status publishedSnapshot visibility creator").lean();
      notification.unavailable = !publication || publication.status !== "PUBLISHED" || ((publication.publishedSnapshot?.metadata?.visibility || publication.visibility) === "PRIVATE" && String(publication.creator) !== String(fanId));
    }
    const da = /^da-(?:refund|answer):(.+)$/.exec(notification.dedupeKey || "");
    const window = da && directAccessWindows.find(row => String(row._id) === da[1]);
    if (window && String(window.fan?._id || window.fan) === String(fanId)) {
      notification.actor = window.creator;
      notification.metadata = { ...notification.metadata, windowId: String(window._id), creatorId: String(window.creator?._id || window.creator), ...(notification.type === "direct_access_refunded" ? { refundCoins: window.priceStars } : {}) };
      if (notification.type === "direct_access_refunded") notification.title = `${window.creator?.name || "The creator"} didn’t reply in 48h — ${window.priceStars} coins are back`;
    }
    if (notification.type !== "story_reaction" || notification.target?.id) continue;
    const legacy = /^story-reaction:([a-f\d]{24}):([a-f\d]{24})$/i.exec(notification.dedupeKey || "");
    if (!legacy) continue;
    notification.target = { type: "STORY", id: legacy[1] };
    notification.actor = await User.findById(legacy[2]).select("name username avatar status").lean();
    notification.metadata = { ...notification.metadata, reaction: notification.title?.match(/reacted (.+?) to your story/)?.[1] || null };
  }
  const storyIds = notifications.filter((item) => item.target?.type === "STORY").map((item) => item.target.id).filter(Boolean);
  const currentStories = await Story.find({ _id: { $in: storyIds }, expiresAt: { $gt: new Date() } }).lean();
  const audienceCache = new Map();
  for (const notification of notifications.filter((item) => item.target?.type === "STORY")) {
    const story = currentStories.find((item) => String(item._id) === String(notification.target.id));
    notification.message = "";
    notification.metadata = { ...notification.metadata };
    for (const key of ["imageUrl", "videoUrl", "thumbnailUrl", "previewUrl"]) delete notification.metadata[key];
    if (!story) continue;
    const creatorId = String(story.creator);
    if (!audienceCache.has(creatorId)) audienceCache.set(creatorId, await storyAudiencesFor(story.creator, fanId));
    if (!audienceCache.get(creatorId).has(story.audience || "everyone")) continue;
    notification.message = notification.type === "story_mention" ? "Tap to add it to your story" : notification.type === "story_mention_sent" ? "" : story.caption || "";
    if (notification.type !== "story_mention_sent") notification.metadata = { ...notification.metadata, imageUrl: story.mediaType === "video" ? "" : story.image?.url, videoUrl: story.mediaType === "video" ? story.image?.url : "", contentType: "STORY" };
  }

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
  const giftThanksByKey = new Map([
    ...sentChatGifts.map((gift) => [`gift-thanks:chat:${gift._id}`, { gift, kind: "chat" }]),
    ...sentDreamGifts.map((gift) => [`gift-thanks:dream:${gift._id}`, { gift, kind: "dream" }]),
  ]);
  // Older publications have canonical mention metadata but no author-side notification.
  // Read that history without manufacturing recipient notifications or rewriting stories.
  const mentionedStories = await Story.find({ creator: fanId, "editorMetadata.mentions.0": { $exists: true } })
    .sort({ createdAt: -1 }).limit(limit).select("createdAt editorMetadata.mentions").lean();
  const mentionedIds = [...new Set(mentionedStories.flatMap((story) => story.editorMetadata.mentions.map((mention) => String(mention.userId))))];
  const mentionedPeople = mentionedIds.length ? await User.find({ _id: { $in: mentionedIds } }).select("name username avatar status").lean() : [];
  const sentMentionHistory = mentionedStories.flatMap((story) => story.editorMetadata.mentions.map((mention) => {
    const person = mentionedPeople.find((entry) => String(entry._id) === String(mention.userId));
    if (!person || String(mention.userId) === String(fanId)) return null;
    const dedupeKey = `story-mention-sent:${story._id}:${mention.userId}`;
    return activityBase({ id: dedupeKey, type: "story_mention_sent", direction: "sent", filter: "mentions",
      title: `You mentioned ${person.name || person.username} in your story`, actor: serializeCreator(person),
      target: { type: "STORY", id: String(story._id) }, actionPath: `/stories/${story._id}`,
      createdAt: story.createdAt, canAcknowledge: false, dedupeKey });
  }).filter(Boolean));
  const activity = [
    ...await supplementalActivity(fanId, limit),
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
    ...receivedChatGifts.map((gift) => giftActivity(gift, "received", gift.sourceType === "STORY" ? "Story" : "Direct")),
    ...sentChatGifts.map((gift) => giftActivity(gift, "sent", gift.sourceType === "STORY" ? "Story" : "Direct")),
    ...receivedDreamGifts.map((gift) => giftActivity(gift, "received", "Dream")),
    ...sentDreamGifts.map((gift) => giftActivity(gift, "sent", "Dream")),
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
    ...transactions.filter((transaction) => !["CHAT_GIFT_DEBIT", "CHAT_GIFT_EARNING", "DREAM_GIFT_DEBIT", "DREAM_CREATOR_EARNING"].includes(transaction.type || transaction.event || transaction.transactionType)).map(transactionActivity),
    ...messages
      .filter((message) => message.sender?.role === "creator" && message.sender?.status === "active")
      .filter((message) => !message.storyReactionKey && !notifications.some((notification) => notification.type === "story_reply" && String(notification.target?.messageId || "") === String(message._id)))
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
        actionPath: `/messages?with=${message.sender._id}&message=${message._id}`,
      })),
    ...notifications
      .filter(notification => !notification.unavailable)
      .filter((notification) => !["chat_gift", "direct_gift", "story_gift", "dream_gift", "direct_access_opened"].includes(notification.type))
      .map((notification) => notificationActivity(notification, giftThanksByKey)),
    ...sentMentionHistory,
  ];

  const dedupeKeyFor = (item) => {
    if (/^(premium_)?membership_cancelled$/.test(item.type || "") && item.metadata?.membershipId) {
      return `membership-cancelled:${item.metadata.membershipId}`;
    }
    return item.dedupeKey || item.id;
  };
  const richness = (item) => Number(Boolean(item.actor)) * 8
    + Number(Boolean(item.target?.id || item.reference?.id)) * 4
    + Number(Boolean(item.preview || item.description)) * 2
    + Number(Boolean(item.actionPath));
  const byDedupeKey = new Map();
  activity.forEach((item) => {
    const key = dedupeKeyFor(item);
    const current = byDedupeKey.get(key);
    if (!current || richness(item) > richness(current)) byDedupeKey.set(key, item);
  });
  const ordered = [...byDedupeKey.values()]
    .sort((left, right) => (new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()) || (Number(right.priority) - Number(left.priority)));
  return (truncate ? ordered.slice(0, limit) : ordered).map(serializeActivityItem);
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
  const todayStart = req.query.todayStart ? new Date(req.query.todayStart) : null;
  const includeTodaySeen = direction === "received" && filter === "all" && todayStart && !Number.isNaN(todayStart.getTime());
  const todaySeenQuery = includeTodaySeen
    ? { targetUser: req.user._id, type: "SEE_YOU", status: "active", signaledAt: { $gte: todayStart } }
    : null;
  const [todaySeenCount, todaySeenSignals] = todaySeenQuery
    ? await Promise.all([
      OrbitSignal.countDocuments(todaySeenQuery),
      OrbitSignal.find(todaySeenQuery).sort({ signaledAt: -1 }).limit(3)
        .populate({ path: "sender", match: { status: "active" }, select: "name username avatar role status" }).lean(),
    ])
    : [0, []];
  const requestedLimit = limitFromQuery(req.query.limit, 30);
  const page = Math.max(1, Number(req.query.page) || 1);
  // Bound each source query, but keep the combined candidates until after the
  // direction/category filter. Otherwise newer unrelated events hide Saves.
  const queryLimit = 100;
  const allActivity = await applyAcknowledgements(await getActivity(req.user._id, wallet, queryLimit, { truncate: false }));
  const filteredActivity = filterActivityItems(allActivity, { direction, filter });
  const activity = filteredActivity.slice(0, requestedLimit * page);

  return sendResponse(res, 200, "Fan activity fetched", {
    activity,
    items: activity,
    todaySeen: includeTodaySeen ? {
      count: todaySeenCount,
      people: todaySeenSignals.filter((signal) => signal.sender).map((signal) => serializeCreator(signal.sender)),
    } : null,
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

  const wallet = await Wallet.findOne({ user: req.user._id }).lean();
  const receivedItems = await getActivity(req.user._id, wallet, 100);
  const activity = receivedItems.find((item) => String(item.id) === activityId && item.direction === "received" && item.canAcknowledge);
  if (!activity) return sendResponse(res, 404, "Activity not found", { acknowledged: false });

  await ActivityAcknowledgement.findOneAndUpdate(
    { eventKey: acknowledgementKey(activityId) },
    { $set: { acknowledgedBy: req.user._id, acknowledgedAt } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (activityId.startsWith("notification-")) {
    const notificationId = activityId.replace("notification-", "");
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, user: req.user._id },
      { $set: { acknowledgedAt, readAt: acknowledgedAt } },
      { new: true },
    ).lean();

    req.app.get("io")?.to(`user:${req.user._id}`).emit("activity:updated");

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

    req.app.get("io")?.to(`user:${req.user._id}`).emit("activity:updated");

    return sendResponse(res, signal ? 200 : 404, signal ? "Activity acknowledged" : "Activity not found", {
      acknowledged: Boolean(signal),
      acknowledgedAt: signal?.acknowledgedAt || null,
    });
  }

  req.app.get("io")?.to(`user:${req.user._id}`).emit("activity:updated");
  return sendResponse(res, 200, "Activity acknowledged", { acknowledged: true, acknowledgedAt });
});

export const acknowledgeAllFanActivity = asyncHandler(async (req, res) => {
  const acknowledgedAt = new Date();
  const wallet = await Wallet.findOne({ user: req.user._id }).lean();
  const activity = await applyAcknowledgements(await getActivity(req.user._id, wallet, 100));
  const unread = activity.filter((item) => item.direction === "received" && item.canAcknowledge && !item.acknowledged && !item.read);
  const keys = [...new Set(unread.map((item) => acknowledgementKey(item.id)))];

  if (keys.length) {
    await ActivityAcknowledgement.bulkWrite(keys.map((eventKey) => ({
      updateOne: {
        filter: { eventKey },
        update: { $set: { acknowledgedBy: req.user._id, acknowledgedAt } },
        upsert: true,
      },
    })));
  }

  const notificationIds = unread
    .map((item) => String(item.id || ""))
    .filter((id) => id.startsWith("notification-"))
    .map((id) => id.replace("notification-", ""));
  if (notificationIds.length) {
    await Notification.updateMany(
      { _id: { $in: notificationIds }, user: req.user._id },
      { $set: { acknowledgedAt, readAt: acknowledgedAt } },
    );
  }

  const signalIds = unread
    .map((item) => String(item.id || ""))
    .filter((id) => id.startsWith("profile-see-received-"))
    .map((id) => id.replace("profile-see-received-", ""));
  if (signalIds.length) {
    await OrbitSignal.updateMany(
      { _id: { $in: signalIds }, targetUser: req.user._id, type: "SEE_YOU", status: "active" },
      { $set: { acknowledgedAt } },
    );
  }

  req.app.get("io")?.to(`user:${req.user._id}`).emit("activity:updated", { unreadCount: 0 });

  return sendResponse(res, 200, "Activity acknowledged", {
    acknowledged: keys.length,
    acknowledgedAt,
    unreadCount: 0,
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
  giftActivity,
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
