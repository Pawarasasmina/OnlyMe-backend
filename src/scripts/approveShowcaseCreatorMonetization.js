import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import CreatorVerification from "../models/CreatorVerification.js";
import PayoutBankApplication from "../models/PayoutBankApplication.js";
import PlatformSetting from "../models/PlatformSetting.js";
import User from "../models/User.js";
import { MONETIZATION_POLICY_KEY, monetizationSummary } from "../services/monetizationService.js";

const EMAILS = [
  "maya@gmail.com", "noah@gmail.com", "sofia@gmail.com", "oliver@gmail.com",
  "aisha@gmail.com", "liam@gmail.com", "priya@gmail.com", "lucas@gmail.com",
  "amara@gmail.com", "kenji@gmail.com", "elena@gmail.com", "marcus@gmail.com",
  "zara@gmail.com", "daniel@gmail.com", "nia@gmail.com", "rafael@gmail.com",
  "chloe@gmail.com", "arjun@gmail.com", "hana@gmail.com", "victor@gmail.com",
];

const DEFAULT_COUNTRY = "Sri Lanka";
const DATE_OF_BIRTH = new Date("1990-01-01T00:00:00.000Z");

async function run() {
  if (env.nodeEnv === "production") throw new Error("Refusing to approve showcase accounts while NODE_ENV=production.");
  await connectDb();

  const policyRecord = await PlatformSetting.findOne({ key: MONETIZATION_POLICY_KEY }).lean();
  const policy = { enabled: true, supportedCountries: [], termsVersion: "monetization-v1", ...policyRecord?.value };
  if (!policy.enabled) throw new Error("Monetization policy is disabled. No accounts were changed.");
  const country = policy.supportedCountries?.[0] || DEFAULT_COUNTRY;
  const users = await User.find({ email: { $in: EMAILS } }).select("+accountType");
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  const missing = EMAILS.filter((email) => !byEmail.has(email));
  if (missing.length) throw new Error(`No accounts were changed. Missing users: ${missing.join(", ")}`);

  const now = new Date();
  const report = [];
  for (const email of EMAILS) {
    const user = byEmail.get(email);
    user.role = "creator";
    user.status = "active";
    user.creatorApprovalStatus = "approved";
    user.isVerified = true;
    user.profileAccountType = "creator";
    user.profileType = "creator";
    user.profileCategory ||= "Digital creator";
    user.loginRestrictedUntil = null;
    user.messagingRestrictedUntil = null;
    user.postingRestrictedUntil = null;
    user.sellingRestrictedUntil = null;
    user.monetization = {
      dateOfBirth: DATE_OF_BIRTH,
      country,
      termsAcceptedAt: now,
      termsVersion: policy.termsVersion,
    };
    await user.save();

    await CreatorVerification.findOneAndUpdate(
      { creator: user._id },
      { $set: {
        purpose: "IDENTITY", status: "APPROVED", category: user.profileCategory,
        legalFullName: user.name, dateOfBirth: DATE_OF_BIRTH, country,
        ageConfirmed: true, informationConfirmed: true, policyAccepted: true,
        policyVersion: policy.termsVersion, acceptedAt: now, submittedAt: now,
        reviewedAt: now, adminInternalNote: "Approved showcase creator account",
        creatorVisibleMessage: "Identity and monetization approved", stateSyncPending: false,
        stateSyncError: "",
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await PayoutBankApplication.findOneAndUpdate(
      { user: user._id },
      { $set: {
        status: "APPROVED", accountHolder: user.name, bankName: "Showcase Test Bank",
        country, currency: "USD", accountLast4: "0000",
        encryptedDetails: `showcase-approved:${user._id}`, automaticPayout: true,
        submittedAt: now, reviewedAt: now, reviewMessage: "Approved for local showcase testing",
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const refreshed = await User.findById(user._id).select("+accountType");
    const summary = await monetizationSummary(refreshed);
    report.push({
      email,
      enabled: summary.enabled,
      paidSeens: summary.tools.paidSeens,
      world: summary.tools.world,
      directAccess: summary.tools.directAccess,
      gifts: summary.tools.gifts,
    });
  }

  console.table(report);
  if (report.some((row) => !row.enabled || !row.paidSeens || !row.world || !row.directAccess)) {
    throw new Error("At least one creator still failed required monetization checks. Review the report above.");
  }
  console.log(`Approved monetization for ${report.length} showcase creators.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => mongoose.disconnect());
