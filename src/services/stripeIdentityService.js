import IdentityVerification from "../models/IdentityVerification.js";
import User from "../models/User.js";
import VerifiedCreatorSubscription from "../models/VerifiedCreatorSubscription.js";
import CreatorVerification from "../models/CreatorVerification.js";
import ApiError from "../utils/ApiError.js";
import { env } from "../config/env.js";
import { countryCode } from "../utils/countryCode.js";

export async function stripeRequest(path, params, key) {
  if (!process.env.STRIPE_SECRET_KEY) throw new ApiError(503, "Verification is not configured yet. Please try again later.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, ...(params && { "Content-Type": "application/x-www-form-urlencoded" }), ...(key && { "Idempotency-Key": key }) },
    ...(params && { body: new URLSearchParams(params) }), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(502, "Stripe could not complete this request. Please try again.");
  return data;
}

export async function syncBank(record) {
  if (!record.connectAccountId) return record;
  const account = await stripeRequest(`accounts/${encodeURIComponent(record.connectAccountId)}`);
  if (account.metadata?.userId && account.metadata.userId !== String(record.user)) throw new ApiError(403, "Bank setup does not belong to this account");
  const bank = account.external_accounts?.data?.find(a => a.object === "bank_account" && !["errored", "verification_failed"].includes(a.status));
  record.payoutsEnabled = Boolean(account.payouts_enabled && !account.deleted);
  record.bankLast4 = bank?.last4 || "";
  record.bankRequirements = account.requirements?.currently_due || [];
  record.bankStatus = record.payoutsEnabled && record.bankLast4 ? "ready" : account.requirements?.disabled_reason ? "restricted" : record.bankRequirements.length ? "requires_input" : "pending";
  await record.save();
  return record;
}

export async function syncIdentity(record) {
  if (!record.sessionId) return record;
  const session = await stripeRequest(`identity/verification_sessions/${encodeURIComponent(record.sessionId)}`);
  if (session.metadata?.userId !== String(record.user)) throw new ApiError(403, "Verification session does not belong to this account");
  if (record.status !== session.status) record.history.push({ action: `STRIPE_${session.status.toUpperCase()}`, at: new Date() });
  record.status = session.status;
  record.errorCode = session.last_error?.code || "";
  if (session.status === "verified") {
    record.verifiedAt ||= new Date();
    if (!record.sealRevokedAt) await User.updateOne({ _id: record.user }, { $set: { isVerified: true } });
    // Identity verification replaces the legacy paid badge subscription.
    await VerifiedCreatorSubscription.updateOne({ creator: record.user, autoRenew: true }, { $set: { autoRenew: false, status: "CANCELLED" } });
  }
  await record.save();
  return record;
}

export async function identityStatus(user) {
  const available = Boolean(process.env.STRIPE_SECRET_KEY);
  const manual = await CreatorVerification.findOne({ creator: user._id, purpose: "IDENTITY" }).select("status reviewedAt stateSyncPending").lean();
  const record = await IdentityVerification.findOne({ user: user._id });
  const manualStatus = manual ? { provider: "manual", available: true, bankAvailable: available, status: manual.status === "APPROVED" && !manual.stateSyncPending ? "verified" : manual.status.toLowerCase(), verifiedAt: manual.reviewedAt } : {};
  if (!record) return { available, bankAvailable: available, status: "not_started", bankReady: false, bankStatus: "not_started", automaticPayout: true, ...manualStatus };
  if (!manual && available && record.sessionId && record.status !== "verified") await syncIdentity(record);
  if (available && record.connectAccountId) {
    await syncBank(record);
  }
  return { available, bankAvailable: available, status: record.status, sealRevoked: manualStatus.status === "verified" ? false : Boolean(record.sealRevokedAt), errorCode: record.errorCode, verifiedAt: record.verifiedAt, bankReady: Boolean(record.payoutsEnabled && record.bankLast4 && (manualStatus.status === "verified" || record.status === "verified")), bankStatus: record.bankStatus, bankLast4: record.bankLast4 || "", automaticPayout: record.automaticPayout, ...manualStatus };
}

export async function startIdentity(user) {
  let record = await IdentityVerification.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { new: true, upsert: true });
  if (record.sessionId) {
    await syncIdentity(record);
    if (record.status === "verified") return { verified: true };
    if (record.status === "processing") return { processing: true };
    const existing = await stripeRequest(`identity/verification_sessions/${record.sessionId}`);
    if (existing.url) return { url: existing.url };
  }
  const session = await stripeRequest("identity/verification_sessions", { type: "document", "options[document][require_matching_selfie]": "true", "metadata[userId]": String(user._id), return_url: `${env.clientUrl}/settings?verification=return` }, `identity-${user._id}-${record.sessionId || "first"}`);
  record.sessionId = session.id; record.status = session.status; await record.save();
  return { url: session.url };
}

export async function startBank(user, returnTo = "settings") {
  if (!["settings", "monetization"].includes(returnTo)) throw new ApiError(400, "Invalid bank return destination");
  const manuallyVerified = await CreatorVerification.exists({ creator: user._id, purpose: "IDENTITY", status: "APPROVED", stateSyncPending: false });
  let record = await IdentityVerification.findOne({ user: user._id });
  if (manuallyVerified && !record) record = await IdentityVerification.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true, new: true });
  if (!manuallyVerified && (!record || (await syncIdentity(record)).status !== "verified")) throw new ApiError(403, "Complete identity verification first");
  if (!record.connectAccountId) {
    const identity = manuallyVerified ? await CreatorVerification.findOne({ creator: user._id, purpose: "IDENTITY", status: "APPROVED", stateSyncPending: false }).select("country").lean() : null;
    const country = countryCode(identity?.country || user.monetization?.country);
    const account = await stripeRequest("accounts", { type: "express", email: user.email, ...(country ? { country, "capabilities[transfers][requested]": "true" } : {}), "metadata[userId]": String(user._id) }, `connect-${user._id}`);
    record.connectAccountId = account.id; await record.save();
  }
  const path = returnTo === "monetization" ? "/settings/monetization" : "/settings";
  const base = String(env.clientUrl).replace(/\/+$/, "");
  const link = await stripeRequest("account_links", { account: record.connectAccountId, type: "account_onboarding", "collection_options[fields]": "eventually_due", return_url: `${base}${path}?verification=bank-return`, refresh_url: `${base}${path}?verification=bank-refresh` });
  return { url: link.url };
}

export async function updateAutomaticPayout(user, active) {
  if (typeof active !== "boolean") throw new ApiError(400, "Choose an automatic payout setting");
  const record = await IdentityVerification.findOne({ user: user._id });
  if (!record?.connectAccountId) throw new ApiError(400, "Add a bank first");
  await stripeRequest(`accounts/${record.connectAccountId}`, { "settings[payouts][schedule][interval]": active ? "monthly" : "manual", ...(active && { "settings[payouts][schedule][monthly_anchor]": "1" }) });
  record.automaticPayout = active; await record.save();
  return { automaticPayout: active };
}
