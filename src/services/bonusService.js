import BonusGrant from "../models/BonusGrant.js";
import { executeFinancialCommand } from "./financialCommandService.js";
import { debitWallet } from "./walletLedgerService.js";
import { fingerprint } from "../validators/financialValidator.js";

export const BONUS_EXPIRY_DAYS = 90;
export const welcomeBonusFor = (baseStars) => Math.min(50, Math.floor(Number(baseStars || 0) * 0.1));
export const bonusExpiryAt = (from = new Date()) => new Date(from.getTime() + BONUS_EXPIRY_DAYS * 86400000);

export async function createBonusGrant({ user, sourceLedgerEntry, packBonusStars, welcomeBonusStars, now = new Date() }, session) {
  const grantedStars = Number(packBonusStars || 0) + Number(welcomeBonusStars || 0);
  if (!grantedStars) return null;
  const [grant] = await BonusGrant.create([{ user, sourceLedgerEntry, grantedStars, remainingStars: grantedStars, packBonusStars, welcomeBonusStars, expiresAt: bonusExpiryAt(now) }], { session });
  return grant;
}

export async function processExpiredBonusGrants(now = new Date()) {
  const due = await BonusGrant.find({ remainingStars: { $gt: 0 }, expiresAt: { $lte: now }, expiredAt: null }).sort({ expiresAt: 1 }).limit(100).lean();
  let processed = 0;
  for (const dueGrant of due) {
    const key = `bonus-expiry:${dueGrant._id}`;
    try {
      await executeFinancialCommand({ user: dueGrant.user, commandType: "EXPIRE_BONUS", idempotencyKey: key, requestFingerprint: fingerprint({ grantId: String(dueGrant._id), amount: dueGrant.remainingStars }) }, async (session, command) => {
        const grant = await BonusGrant.findOne({ _id: dueGrant._id, remainingStars: { $gt: 0 }, expiresAt: { $lte: now }, expiredAt: null }).session(session);
        if (!grant) return { resultReference: dueGrant._id, skipped: true };
        const amount = grant.remainingStars;
        const posted = await debitWallet({ user: grant.user, amount, entryType: "BONUS_EXPIRED_DEBIT", entryRole: "BONUS_EXPIRY", referenceType: "BONUS_GRANT", referenceId: grant._id, command, idempotencyKey: key, metadata: { skipBonusGrantConsumption: true, expiresAt: grant.expiresAt } }, session);
        grant.remainingStars = 0;
        grant.expiredAt = now;
        await grant.save({ session });
        return { resultReference: posted.entry._id, expiredStars: amount };
      });
      processed += 1;
    } catch (error) {
      console.error("Bonus expiry failed", { grantId: String(dueGrant._id), code: error.code || "BONUS_EXPIRY_FAILED" });
    }
  }
  return { processed };
}
