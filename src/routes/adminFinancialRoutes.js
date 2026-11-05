import { Router } from "express";
import { activateFanWallet, creditStars, getCoinTaxRate, getExchangeRate, getPlatformRevenue, listPayouts, listUserWallets, updateCoinTaxRate, updateExchangeRate, updatePayoutStatus } from "../controllers/adminFinancialController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { adminFinancialMutationLimit } from "../middleware/financialRateLimit.js";
import { getMonetizationPolicyAdmin, updateMonetizationPolicyAdmin } from "../controllers/monetizationController.js";
import { requireAdminRole } from "../middleware/adminPermissionMiddleware.js";

const router = Router();
router.use(protect, authorize("admin"));
router.use(requireAdminRole("MAIN_ADMIN", "FINANCE"));
router.get("/wallets", listUserWallets);
router.get("/platform-revenue", getPlatformRevenue);
router.get("/exchange-rate", getExchangeRate);
router.get("/coin-tax-rate", getCoinTaxRate);
router.get("/monetization-policy", getMonetizationPolicyAdmin);
router.get("/payouts", listPayouts);
router.use(adminFinancialMutationLimit);
router.put("/exchange-rate", updateExchangeRate);
router.put("/coin-tax-rate", updateCoinTaxRate);
router.put("/monetization-policy", updateMonetizationPolicyAdmin);
router.post("/wallets/:userId/activate-ledger", activateFanWallet);
router.post("/wallets/:userId/credit-stars", creditStars);
router.patch("/payouts/:id/status", updatePayoutStatus);

export default router;
