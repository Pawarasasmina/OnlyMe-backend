import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import Publication from "../models/Publication.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import FinancialCommand from "../models/FinancialCommand.js";
import WorldEntitlement from "../models/WorldEntitlement.js";
import PremiumMembership from "../models/PremiumMembership.js";
import { joinPremium } from "./premiumMembershipService.js";
import { executeFinancialCommand } from "./financialCommandService.js";
import { creditWallet, safeWallet } from "./walletLedgerService.js";
import { fingerprint } from "../validators/financialValidator.js";

const uri = process.env.TEST_MONGODB_URI;
before(async () => { if (!uri) return; await mongoose.connect(uri); await mongoose.connection.db.dropDatabase(); await Promise.all([User.syncIndexes(), Wallet.syncIndexes(), Publication.syncIndexes(), StarsLedgerEntry.syncIndexes(), FinancialCommand.syncIndexes(), WorldEntitlement.syncIndexes(), PremiumMembership.syncIndexes()]); });
after(async () => { if (!uri) return; await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); });

test("transaction hardening: concurrent Premium join and duplicate admin credit", { skip: !uri }, async () => {
  const suffix = Date.now();
  const [fan, creator, admin] = await User.create([{ name: "Fan", username: `hard_fan_${suffix}`, email: `hard-fan-${suffix}@test.local`, password: "password123", role: "fan" }, { name: "Creator", username: `hard_creator_${suffix}`, email: `hard-creator-${suffix}@test.local`, password: "password123", role: "creator", creatorApprovalStatus: "approved" }, { name: "Admin", username: `hard_admin_${suffix}`, email: `hard-admin-${suffix}@test.local`, password: "password123", role: "admin" }]);
  const credit = (key) => executeFinancialCommand({ user: admin._id, commandType: "ADMIN_CREDIT", idempotencyKey: key, requestFingerprint: fingerprint({ target: String(fan._id), amount: 500, reason: "test credit" }) }, async (session, command) => { const posted = await creditWallet({ user: fan._id, amount: 500, entryType: "CREDIT_ADMIN", entryRole: "ADMIN_CREDIT", referenceType: "ADMIN_CREDIT", referenceId: command._id, command, idempotencyKey: key, counterpartyUser: admin._id, metadata: { reason: "test credit" } }, session); return { resultReference: posted.entry._id, wallet: safeWallet(posted.wallet) }; });
  const credits = await Promise.allSettled([credit("duplicate-admin-credit"), credit("duplicate-admin-credit")]);
  assert.equal(credits.filter((item) => item.status === "fulfilled").length, 1);
  await credit("duplicate-admin-credit");
  assert.equal(await StarsLedgerEntry.countDocuments({ accountUser: fan._id, entryType: "CREDIT_ADMIN" }), 1);
  const publishedSnapshot = { version: 1, metadata: { kind: "PREMIUM_WORLD", title: "Premium", summary: "Summary", description: "", category: "Test", tags: [], pricing: { mode: "MONTHLY", starsAmount: 90, presetId: "P90" }, planet: { slot: "PREMIUM" } }, chapters: [{ stableChapterId: "c1", order: 0, title: "Preview", isPreview: true, blocks: [] }, { stableChapterId: "c2", order: 1, title: "Locked", isPreview: false, blocks: [] }], frozenAt: new Date() };
  const premium = await Publication.create({ creator: creator._id, kind: "PREMIUM_WORLD", title: "Premium", summary: "Summary", category: "Test", pricing: { mode: "MONTHLY", starsAmount: 90, presetId: "P90" }, previewPolicy: "ONE_OR_TWO_CHAPTERS", status: "PUBLISHED", publishedSnapshot, publishedVersion: 1, publishedAt: new Date() });
  const joins = await Promise.allSettled([joinPremium({ user: fan, publicationId: premium._id, key: "join-a" }), joinPremium({ user: fan, publicationId: premium._id, key: "join-b" })]);
  assert.equal(joins.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await PremiumMembership.countDocuments({ user: fan._id, creator: creator._id, status: "ACTIVE" }), 1);
  assert.ok((await Wallet.findOne({ user: fan._id })).balance >= 0);
});
