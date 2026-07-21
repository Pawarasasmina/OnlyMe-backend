import Wallet from "../models/Wallet.js";
import StarsLedgerEntry from "../models/StarsLedgerEntry.js";
import ApiError from "../utils/ApiError.js";

export async function activateWalletLedger({ user, openingBalance, reason, admin, command, idempotencyKey }, session) {
  const wallets = await Wallet.find({ user }).limit(2).session(session);
  if (wallets.length > 1) throw new ApiError(409, "Duplicate Wallet records require manual remediation", "DUPLICATE_WALLETS");
  const wallet = wallets[0] || new Wallet({ user, balance: 0 });
  if (await StarsLedgerEntry.exists({ accountUser: user }).session(session)) throw new ApiError(409, "Existing ledger entries require manual reconciliation", "WALLET_LEDGER_NOT_EMPTY");

  const previous = { balance: wallet.balance, currency: wallet.currency };
  wallet.balance = openingBalance;
  wallet.currency = "STARS";
  wallet.version = Number(wallet.version || 0) + 1;
  wallet.ledgerActivatedAt = new Date();
  wallet.reconciliationStatus = "MATCHED";

  let entry = null;
  if (openingBalance > 0) {
    [entry] = await StarsLedgerEntry.create([{
      accountUser: user,
      entryType: "OPENING_BALANCE",
      entryRole: "ADMIN_APPROVED_OPENING_BALANCE",
      direction: "CREDIT",
      starsAmount: openingBalance,
      signedAmount: openingBalance,
      balanceAfter: openingBalance,
      referenceType: "WALLET_ACTIVATION",
      referenceId: String(command._id),
      counterpartyUser: admin,
      commandId: command._id,
      idempotencyKey,
      metadata: { reason, adminUser: String(admin), previousBalance: previous.balance, previousCurrency: previous.currency },
    }], { session });
    wallet.lastLedgerEntry = entry._id;
  }
  await wallet.save({ session });
  return { wallet, entry, previous };
}
