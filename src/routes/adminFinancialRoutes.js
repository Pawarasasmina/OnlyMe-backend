import { Router } from "express";
import { activateFanWallet, creditStars, getCoinTaxRate, getCreatorReferralSettings, getExchangeRate, getPlatformRevenue, listPayouts, listUserWallets, updateCoinTaxRate, updateCreatorReferralSettings, updateExchangeRate, updatePayoutStatus } from "../controllers/adminFinancialController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { adminFinancialMutationLimit } from "../middleware/financialRateLimit.js";
import { getMonetizationPolicyAdmin, updateMonetizationPolicyAdmin } from "../controllers/monetizationController.js";
import { requireAdminPermission } from "../middleware/adminPermissionMiddleware.js";

const router = Router();
router.use(protect, authorize("admin"));
router.get("/wallets", requireAdminPermission("finance.view"), listUserWallets);
router.get("/platform-revenue", requireAdminPermission("finance.view"), getPlatformRevenue);
router.get("/exchange-rate", requireAdminPermission("finance.view"), getExchangeRate);
router.get("/coin-tax-rate", requireAdminPermission("finance.view"), getCoinTaxRate);
router.get("/creator-referral-settings", requireAdminPermission("finance.view"), getCreatorReferralSettings);
router.get("/monetization-policy", requireAdminPermission("finance.view"), getMonetizationPolicyAdmin);
router.get("/payouts", requireAdminPermission("finance.view"), listPayouts);
router.put("/exchange-rate", adminFinancialMutationLimit, requireAdminPermission("finance.manage"), updateExchangeRate);
router.put("/coin-tax-rate", adminFinancialMutationLimit, requireAdminPermission("finance.manage"), updateCoinTaxRate);
router.put("/creator-referral-settings", adminFinancialMutationLimit, requireAdminPermission("finance.manage"), updateCreatorReferralSettings);
router.put("/monetization-policy", adminFinancialMutationLimit, requireAdminPermission("finance.manage"), updateMonetizationPolicyAdmin);
router.post("/wallets/:userId/activate-ledger", adminFinancialMutationLimit, requireAdminPermission("finance.manage"), activateFanWallet);
router.post("/wallets/:userId/credit-stars", adminFinancialMutationLimit, requireAdminPermission("finance.manage"), creditStars);
router.patch("/payouts/:id/status", adminFinancialMutationLimit, requireAdminPermission("finance.manage"), updatePayoutStatus);

export default router;
