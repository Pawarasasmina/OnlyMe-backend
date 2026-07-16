import Content from "../models/Content.js";
import FanProfile from "../models/FanProfile.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import Subscription from "../models/Subscription.js";
import Transaction from "../models/Transaction.js";
import Wallet from "../models/Wallet.js";
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
    displayName: user.name,
    username: user.username,
    avatarUrl: user.avatar || null,
  };
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
    createdAt: item.createdAt,
    relatedCreator: item.relatedCreator || null,
    relatedContent: item.relatedContent || null,
    actionPath: item.actionPath || null,
  };
}

async function getActivity(fanId, wallet, limit = DEFAULT_LIMITS.dashboardActivity) {
  const [subscriptions, notifications, transactions, messages] = await Promise.all([
    Subscription.find({ fan: fanId }).sort({ updatedAt: -1 }).limit(limit).populate("creator", "name username avatar").lean(),
    Notification.find({ user: fanId }).sort({ createdAt: -1 }).limit(limit).lean(),
    wallet
      ? Transaction.find({ wallet: wallet._id }).sort({ createdAt: -1 }).limit(limit).lean()
      : Promise.resolve([]),
    Message.find({ recipient: fanId }).sort({ createdAt: -1 }).limit(limit).populate("sender", "name username avatar role status").lean(),
  ]);

  return [
    ...subscriptions.map((subscription) => ({
      id: `subscription-${subscription._id}`,
      type: "subscription",
      description:
        subscription.status === "active"
          ? `Subscribed to ${subscription.creator?.name || "a creator"}`
          : `Subscription ${subscription.status || "updated"}`,
      createdAt: subscription.updatedAt || subscription.createdAt,
      relatedCreator: serializeCreator(subscription.creator),
      actionPath: "/fan/subscriptions",
    })),
    ...notifications.map((notification) => ({
      id: `notification-${notification._id}`,
      type: notification.type || "notification",
      description: notification.title,
      createdAt: notification.createdAt,
      actionPath: "/fan/activity",
    })),
    ...transactions.map((transaction) => {
      const direction = transactionDirection(transaction);

      return {
        id: `transaction-${transaction._id}`,
        type: direction === "credit" ? "wallet_credit" : "wallet_debit",
        description: transaction.description || (direction === "credit" ? "Purchased coins" : "Spent coins"),
        createdAt: transaction.createdAt,
        actionPath: "/fan/wallet",
      };
    }),
    ...messages
      .filter((message) => message.sender?.role === "creator" && message.sender?.status === "active")
      .map((message) => ({
        id: `message-${message._id}`,
        type: "message",
        description: `Received a creator reply from ${message.sender?.name || "a creator"}`,
        createdAt: message.createdAt,
        relatedCreator: serializeCreator(message.sender),
        actionPath: "/fan/messages",
      })),
  ]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
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
  const activity = await getActivity(req.user._id, wallet, limitFromQuery(req.query.limit));

  return sendResponse(res, 200, "Fan activity fetched", {
    activity,
  });
});

export const getFanContentAccess = asyncHandler(async (req, res) => {
  const content = await Content.findOne({ _id: req.params.contentId, status: "published" }).select("_id").lean();

  return sendResponse(res, content ? 403 : 404, content ? "Content access is not available for this fan" : "Content not found");
});

export const fanDashboardTestUtils = {
  filterSubscriptions,
  isExpiringSoon,
  messagePreview,
  profileCompletion,
  subscriptionSummary,
  transactionDirection,
};
