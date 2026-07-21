import { Router } from "express";
import { activateFanWallet, creditStars, listFanWallets, refundPremiumMembership, refundWorldEntitlement } from "../controllers/adminFinancialController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { adminFinancialMutationLimit } from "../middleware/financialRateLimit.js";

const router = Router();
router.use(protect, authorize("admin"));
router.get("/wallets", listFanWallets);
router.use(adminFinancialMutationLimit);
router.post("/wallets/:userId/activate-ledger", activateFanWallet);
router.post("/wallets/:userId/credit-stars", creditStars);
router.post("/world-entitlements/:id/refund", refundWorldEntitlement);
router.post("/premium-memberships/:id/refund-current-period", refundPremiumMembership);

export default router;
