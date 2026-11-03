import crypto from "node:crypto";
import mongoose from "mongoose";
import PayoutBankApplication from "../models/PayoutBankApplication.js";
import CreatorVerification from "../models/CreatorVerification.js";
import ApiError from "../utils/ApiError.js";
import { countryCode } from "../utils/countryCode.js";
const key = () => {
  const value = process.env.BANK_DETAILS_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new ApiError(503, "Bank setup is temporarily unavailable");
  return Buffer.from(value, "hex");
};
export const bankSetupAvailable = () => /^[a-fA-F0-9]{64}$/.test(process.env.BANK_DETAILS_ENCRYPTION_KEY || "");
export function encryptBankDetails(details) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(details), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString("base64")).join(".");
}
export function decryptBankDetails(value) {
  const [iv, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
}
export const serializeBank = bank => bank ? { id: String(bank._id), status: bank.status, accountHolder: bank.accountHolder, bankName: bank.bankName, country: bank.country, currency: bank.currency, accountLast4: bank.accountLast4, version: bank.version, automaticPayout: bank.automaticPayout, reviewMessage: bank.reviewMessage, submittedAt: bank.submittedAt, reviewedAt: bank.reviewedAt } : null;
export async function getManualBank(userId) {
  const bank = await PayoutBankApplication.findOne({ user: userId }).lean();
  return { available: bankSetupAvailable(), bank: serializeBank(bank), bankReady: bank?.status === "APPROVED", bankLast4: bank?.status === "APPROVED" ? bank.accountLast4 : "", bankStatus: bank?.status || "not_started", automaticPayout: bank?.automaticPayout ?? true };
}
export async function manualPayoutIdentityStatus(user) {
  const [identity, bank] = await Promise.all([
    CreatorVerification.findOne({ creator: user._id, purpose: "IDENTITY" }).select("status reviewedAt stateSyncPending").lean(),
    getManualBank(user._id),
  ]);
  const verified = identity?.status === "APPROVED" && !identity.stateSyncPending;
  return { provider: "manual", bankProvider: "manual", available: true, status: verified ? "verified" : identity?.status?.toLowerCase() || "not_started", verifiedAt: identity?.reviewedAt, bankAvailable: bank.available, bankReady: Boolean(verified && bank.bankReady), bankStatus: bank.bankStatus, bankLast4: bank.bankLast4, bankName: bank.bank?.bankName || "", automaticPayout: bank.automaticPayout };
}
const clean = (value, name, max = 150) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ApiError(400, `Enter a valid ${name}`);
  return value.trim();
};
export async function submitManualBank(user, payload) {
  if (!payload || typeof payload !== "object") throw new ApiError(400, "Provide bank application details");
  if (!await CreatorVerification.exists({ creator: user._id, purpose: "IDENTITY", status: "APPROVED", stateSyncPending: false })) throw new ApiError(403, "Complete admin identity verification first");
  if (payload.confirmOwnership !== true) throw new ApiError(400, "Confirm that these bank details belong to you");
  if (!Number.isSafeInteger(payload.version) || payload.version < 0) throw new ApiError(400, "Refresh your bank application before submitting");
  const accountHolder = clean(payload.accountHolder, "account holder name"), bankName = clean(payload.bankName, "bank name");
  const country = countryCode(payload.country);
  if (!country) throw new ApiError(400, "Enter a valid bank country");
  const currency = String(payload.currency || "").toUpperCase();
  if (!Intl.supportedValuesOf("currency").includes(currency)) throw new ApiError(400, "Choose a valid three-letter currency code");
  const accountNumber = clean(payload.accountNumber, "account number or IBAN", 50).replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{6,40}$/.test(accountNumber)) throw new ApiError(400, "Enter a valid account number or IBAN");
  const swift = String(payload.swift || "").trim().toUpperCase();
  if (swift && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift)) throw new ApiError(400, "Enter a valid SWIFT/BIC code");
  const routing = String(payload.routing || "").trim();
  if (routing.length > 40 || !/^[A-Za-z0-9 -]*$/.test(routing)) throw new ApiError(400, "Enter a valid routing or branch code");
  if (!swift && !routing) throw new ApiError(400, "Enter a SWIFT/BIC or routing/branch code");
  const now = new Date();
  const values = { accountHolder, bankName, country, currency, accountLast4: accountNumber.slice(-4), encryptedDetails: encryptBankDetails({ accountNumber, swift, routing }), status: "PENDING_REVIEW", submittedAt: now, reviewedAt: null, reviewedBy: null, reviewMessage: "" };
  let bank;
  if (payload.version === 0) {
    try { bank = await PayoutBankApplication.create({ user: user._id, ...values, history: [{ action: "SUBMITTED", by: user._id, at: now, version: 1 }] }); }
    catch (error) { if (error.code === 11000) throw new ApiError(409, "Bank details changed. Please refresh."); throw error; }
  } else {
    bank = await PayoutBankApplication.findOneAndUpdate({ user: user._id, version: payload.version, status: { $ne: "PENDING_REVIEW" } }, { $set: values, $inc: { version: 1 }, $push: { history: { action: "RESUBMITTED", by: user._id, at: now, version: payload.version + 1 } } }, { new: true, runValidators: true });
    if (!bank) throw new ApiError(409, "This application is under review or has changed. Please refresh.");
  }
  return serializeBank(bank);
}
export async function reviewManualBank(id, adminId, payload) {
  if (!payload || typeof payload !== "object") throw new ApiError(400, "Provide a review decision");
  if (!mongoose.isValidObjectId(id) || !Number.isSafeInteger(payload.version)) throw new ApiError(400, "Invalid bank application");
  if (!["APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(payload.status)) throw new ApiError(400, "Choose a valid review decision");
  if (payload.reviewConfirmed !== true) throw new ApiError(400, "Confirm that you reviewed the bank details");
  const existing = await PayoutBankApplication.findById(id).select("user").lean();
  if (!existing) throw new ApiError(404, "Bank application not found");
  if (String(existing.user) === String(adminId)) throw new ApiError(403, "Another administrator must review your bank details");
  if (payload.status === "APPROVED" && !await CreatorVerification.exists({ creator: existing.user, purpose: "IDENTITY", status: "APPROVED", stateSyncPending: false })) throw new ApiError(409, "Identity verification must be approved before bank approval");
  const note = typeof payload.message === "string" ? payload.message.trim() : "";
  if (note.length > 1000 || payload.status !== "APPROVED" && note.length < 5) throw new ApiError(400, "Provide a review message of 5–1000 characters");
  const now = new Date();
  const bank = await PayoutBankApplication.findOneAndUpdate({ _id: id, status: "PENDING_REVIEW", version: payload.version }, { $set: { status: payload.status, reviewedAt: now, reviewedBy: adminId, reviewMessage: note }, $inc: { version: 1 }, $push: { history: { action: payload.status, by: adminId, at: now, note, version: payload.version } } }, { new: true, runValidators: true });
  if (!bank) throw new ApiError(409, "This application was already reviewed or changed");
  return bank;
}
