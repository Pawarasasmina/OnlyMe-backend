import { muteAccount } from "../controllers/profileController.js";
import { Router } from "express";
import {
  getMyAccountSettings,
  getMyInvitations,
  listMyBlockedAccounts,
  listMyHiddenSeens,
  listMyMutedAccounts,
  showHiddenSeenAgain,
  unblockAccount,
  unmuteAccount,
  getMyNotificationSettings,
  getMyPrivacySettings,
  updateMyAccountSettings,
  updateMyNotificationSettings,
  updateMyPrivacySettings,
  getMyGiftSettings,
  updateMyGiftSettings,
} from "../controllers/profileController.js";
import { protect } from "../middleware/authMiddleware.js";
import { getMonetization, updateMonetization } from "../controllers/monetizationController.js";
import { beginAccountTwoFactorSetup, confirmAccountTwoFactorSetup, disableAccountTwoFactor, getAccountTwoFactorStatus } from "../controllers/accountSecurityController.js";

const router = Router();
router.get("/monetization", protect, getMonetization);
router.put("/monetization", protect, updateMonetization);

router.get("/privacy", protect, getMyPrivacySettings);
router.get("/invitations", protect, getMyInvitations);
router.patch("/privacy", protect, updateMyPrivacySettings);
router.get("/gifts", protect, getMyGiftSettings);
router.put("/gifts", protect, updateMyGiftSettings);
router.get("/blocked-accounts", protect, listMyBlockedAccounts);
router.delete("/blocked-accounts/:userId", protect, unblockAccount);
router.get("/muted-accounts", protect, listMyMutedAccounts);
router.put("/muted-accounts/:userId", protect, muteAccount);
router.delete("/muted-accounts/:userId", protect, unmuteAccount);
router.get("/hidden-seens", protect, listMyHiddenSeens);
router.delete("/hidden-seens/:seenId", protect, showHiddenSeenAgain);
router.get("/notifications", protect, getMyNotificationSettings);
router.patch("/notifications", protect, updateMyNotificationSettings);
router.get("/account", protect, getMyAccountSettings);
router.patch("/account", protect, updateMyAccountSettings);
router.get("/security/2fa", protect, getAccountTwoFactorStatus);
router.post("/security/2fa/setup", protect, beginAccountTwoFactorSetup);
router.post("/security/2fa/confirm", protect, confirmAccountTwoFactorSetup);
router.delete("/security/2fa", protect, disableAccountTwoFactor);

export default router;
