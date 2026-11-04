import { Router } from "express";
import { activateFanWallet, creditStars, getExchangeRate, getPlatformRevenue, listUserWallets, refundPremiumMembership, refundWorldEntitlement, updateExchangeRate } from "../controllers/adminFinancialController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { adminFinancialMutationLimit } from "../middleware/financialRateLimit.js";
import { getMonetizationPolicyAdmin, updateMonetizationPolicyAdmin } from "../controllers/monetizationController.js";

const router = Router();
router.use(protect, authorize("admin"));
router.get("/wallets", listUserWallets);
router.get("/platform-revenue", getPlatformRevenue);
router.get("/exchange-rate", getExchangeRate);
router.get("/monetization-policy", getMonetizationPolicyAdmin);
router.use(adminFinancialMutationLimit);
router.put("/exchange-rate", updateExchangeRate);
router.put("/monetization-policy", updateMonetizationPolicyAdmin);
router.post("/wallets/:userId/activate-ledger", activateFanWallet);
router.post("/wallets/:userId/credit-stars", creditStars);
router.post("/world-entitlements/:id/refund", refundWorldEntitlement);
router.post("/premium-memberships/:id/refund-current-period", refundPremiumMembership);

export default router;
