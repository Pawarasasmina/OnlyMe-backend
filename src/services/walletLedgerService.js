import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import ApiError from "../utils/ApiError.js";
import { FINANCIAL_ERROR_CODES } from "../constants/financialConstants.js";

async function walletFor(user, session, { create = false } = {}) {
  const wallets = await Wallet.find({ user }).limit(2).session(session);
  if (wallets.length > 1) throw new ApiError(409, "Duplicate Wallet records require manual remediation", "DUPLICATE_WALLETS");
  if (wallets[0]) {
    const wallet = wallets[0];
    if (wallet.currency !== "STARS" || !wallet.ledgerActivatedAt || wallet.reconciliationStatus !== "MATCHED") throw new ApiError(409, "Wallet requires approved opening-balance migration", "WALLET_REQUIRES_MIGRATION");
    return wallet;
  }
  if (!create) throw new ApiError(422, "Wallet is unavailable", FINANCIAL_ERROR_CODES.WALLET_UNAVAILABLE);
  const [wallet] = await Wallet.create([{ user, balance: 0, bonusBalance: 0, purchasedBalance: 0, earnedBalance: 0, currency: "STARS", version: 0, ledgerActivatedAt: new Date(), reconciliationStatus: "MATCHED" }], { session });
  return wallet;
}

async function normalizeBuckets(wallet, session) {
  const bonus = Number(wallet.bonusBalance || 0);
  const purchased = Number(wallet.purchasedBalance || 0);
  const earned = Number(wallet.earnedBalance || 0);
  const unclassified = Number(wallet.balance || 0) - bonus - purchased - earned;
  if (!unclassified) return wallet;
  const entries = await StarsLedgerEntry.find({ accountUser: wallet.user }).sort({ createdAt: 1, _id: 1 }).session(session).lean();
  const rebuilt = rebuildWalletBuckets(entries);
  if (rebuilt.bonus + rebuilt.purchased + rebuilt.earned !== Number(wallet.balance || 0)) throw new ApiError(409, "Wallet source balances require reconciliation", "WALLET_BUCKET_DRIFT");
  wallet.bonusBalance = rebuilt.bonus;
  wallet.purchasedBalance = rebuilt.purchased;
  wallet.earnedBalance = rebuilt.earned;
  await wallet.save({ session });
  return wallet;
}

function creatorEarning(entryType) {
  return entryType.endsWith("_CREATOR_EARNING") || entryType === "CHAT_GIFT_EARNING";
}

export function rebuildWalletBuckets(entries = []) {
  const balances = { bonus: 0, purchased: 0, earned: 0 };
  const allocations = new Map();
  for (const entry of entries) {
    const amount = Number(entry.starsAmount || Math.abs(entry.signedAmount || 0));
    let allocation;
    const reversed = entry.reversalOf ? allocations.get(String(entry.reversalOf)) : null;
    if (entry.direction === "CREDIT") {
      allocation = reversed || entry.metadata?.bucketCredit || (entry.entryType === "WALLET_TOPUP_CREDIT"
        ? { bonus: Number(entry.metadata?.bonusStars || 0), purchased: amount - Number(entry.metadata?.bonusStars || 0), earned: 0 }
        : creatorEarning(entry.entryType) ? { bonus: 0, purchased: 0, earned: amount } : { bonus: 0, purchased: amount, earned: 0 });
      for (const key of Object.keys(balances)) balances[key] += Number(allocation[key] || 0);
    } else {
      allocation = reversed || entry.metadata?.bucketSpend;
      if (!allocation) {
        const bonus = Math.min(balances.bonus, amount);
        const purchased = Math.min(balances.purchased, amount - bonus);
        allocation = { bonus, purchased, earned: amount - bonus - purchased };
      }
      for (const key of Object.keys(balances)) balances[key] -= Number(allocation[key] || 0);
    }
    allocations.set(String(entry._id), { bonus: Number(allocation.bonus || 0), purchased: Number(allocation.purchased || 0), earned: Number(allocation.earned || 0) });
  }
  if (Object.values(balances).some((value) => !Number.isSafeInteger(value) || value < 0)) throw new ApiError(409, "Wallet history cannot be classified safely", "WALLET_BUCKET_DRIFT");
  return balances;
}

async function creditBuckets({ amount, bonusAmount, purchasedAmount, earnedAmount, entryType, reversalOf }, session) {
  if (reversalOf) {
    const original = await StarsLedgerEntry.findById(reversalOf).session(session).lean();
    const spent = original?.metadata?.bucketSpend;
    if (spent && Number(spent.bonus || 0) + Number(spent.purchased || 0) + Number(spent.earned || 0) === amount) return { bonus: Number(spent.bonus || 0), purchased: Number(spent.purchased || 0), earned: Number(spent.earned || 0) };
  }
  const bonus = Number(bonusAmount || 0);
  const earned = earnedAmount == null ? (creatorEarning(entryType) ? amount - bonus : 0) : Number(earnedAmount);
  const purchased = purchasedAmount == null ? amount - bonus - earned : Number(purchasedAmount);
  if (![bonus, purchased, earned].every(Number.isSafeInteger) || bonus < 0 || purchased < 0 || earned < 0 || bonus + purchased + earned !== amount) throw new ApiError(400, "Wallet credit source amounts are invalid", "INVALID_WALLET_BUCKETS");
  return { bonus, purchased, earned };
}

async function debitBuckets(wallet, amount, reversalOf, session) {
  if (reversalOf) {
    const original = await StarsLedgerEntry.findById(reversalOf).session(session).lean();
    const credited = original?.metadata?.bucketCredit;
    if (credited && Number(credited.bonus || 0) + Number(credited.purchased || 0) + Number(credited.earned || 0) === amount) return { bonus: Number(credited.bonus || 0), purchased: Number(credited.purchased || 0), earned: Number(credited.earned || 0) };
  }
  const bonus = Math.min(Number(wallet.bonusBalance || 0), amount);
  const afterBonus = amount - bonus;
  const purchased = Math.min(Number(wallet.purchasedBalance || 0), afterBonus);
  return { bonus, purchased, earned: afterBonus - purchased };
}

async function post({ user, amount, bonusAmount = 0, purchasedAmount, earnedAmount, direction, entryType, entryRole, referenceType, referenceId, publication, creator, counterpartyUser, command, idempotencyKey, reversalOf, metadata = {} }, session) {
  const create = direction === "CREDIT";
  let wallet = await normalizeBuckets(await walletFor(user, session, { create }), session);
  let bucketMetadata;
  if (direction === "DEBIT") {
    bucketMetadata = await debitBuckets(wallet, amount, reversalOf, session);
    wallet = await Wallet.findOneAndUpdate(
      { _id: wallet._id, balance: { $gte: amount }, bonusBalance: { $gte: bucketMetadata.bonus }, purchasedBalance: { $gte: bucketMetadata.purchased }, earnedBalance: { $gte: bucketMetadata.earned } },
      { $inc: { balance: -amount, bonusBalance: -bucketMetadata.bonus, purchasedBalance: -bucketMetadata.purchased, earnedBalance: -bucketMetadata.earned, version: 1 }, $set: { currency: "STARS", ledgerActivatedAt: wallet.ledgerActivatedAt || new Date(), reconciliationStatus: "MATCHED" } },
      { new: true, session, runValidators: true },
    );
    if (!wallet) throw new ApiError(422, "Insufficient Stars", FINANCIAL_ERROR_CODES.INSUFFICIENT_STARS);
  } else {
    bucketMetadata = await creditBuckets({ amount, bonusAmount, purchasedAmount, earnedAmount, entryType, reversalOf }, session);
    wallet = await Wallet.findOneAndUpdate(
      { _id: wallet._id },
      { $inc: { balance: amount, bonusBalance: bucketMetadata.bonus, purchasedBalance: bucketMetadata.purchased, earnedBalance: bucketMetadata.earned, version: 1 }, $set: { currency: "STARS", ledgerActivatedAt: wallet.ledgerActivatedAt || new Date(), reconciliationStatus: "MATCHED" } },
      { new: true, session, runValidators: true },
    );
  }
  const bucketKey = direction === "CREDIT" ? "bucketCredit" : "bucketSpend";
  const [entry] = await StarsLedgerEntry.create([{ accountUser: user, entryType, entryRole, direction, starsAmount: amount, signedAmount: direction === "CREDIT" ? amount : -amount, balanceAfter: wallet.balance, referenceType, referenceId: String(referenceId), publication: publication || null, creator: creator || null, counterpartyUser: counterpartyUser || null, commandId: command._id, idempotencyKey, parentEntry: reversalOf || null, reversalOf: reversalOf || null, metadata: { ...metadata, [bucketKey]: bucketMetadata } }], { session });
  await Wallet.updateOne({ _id: wallet._id }, { $set: { lastLedgerEntry: entry._id } }, { session });
  return { wallet, entry };
}

export const creditWallet = (input, session) => post({ ...input, direction: "CREDIT" }, session);
export const debitWallet = (input, session) => post({ ...input, direction: "DEBIT" }, session);
export async function transferStars({ fromUser, toUser, amount, debitType, creditType, referenceType, referenceId, publication, creator, command, idempotencyKey, metadata }, session) {
  const debit = await debitWallet({ user: fromUser, amount, entryType: debitType, entryRole: "FAN_DEBIT", referenceType, referenceId, publication, creator, counterpartyUser: toUser, command, idempotencyKey, metadata }, session);
  const credit = await creditWallet({ user: toUser, amount, entryType: creditType, entryRole: "CREATOR_EARNING", referenceType, referenceId, publication, creator, counterpartyUser: fromUser, command, idempotencyKey, metadata: { ...metadata, settlementStatus: "UNSETTLED", grossStars: amount } }, session);
  return { debit, credit };
}
export const safeWallet = (wallet) => ({ balance: wallet.balance, bonusBalance: Number(wallet.bonusBalance || 0), purchasedBalance: Number(wallet.purchasedBalance || 0), earnedBalance: Number(wallet.earnedBalance || 0), version: wallet.version, currency: "STARS" });
