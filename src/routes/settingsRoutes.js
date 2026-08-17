import { Router } from "express";
import {
  getMyAccountSettings,
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
} from "../controllers/profileController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/privacy", protect, getMyPrivacySettings);
router.patch("/privacy", protect, updateMyPrivacySettings);
router.get("/blocked-accounts", protect, listMyBlockedAccounts);
router.delete("/blocked-accounts/:userId", protect, unblockAccount);
router.get("/muted-accounts", protect, listMyMutedAccounts);
router.delete("/muted-accounts/:userId", protect, unmuteAccount);
router.get("/hidden-seens", protect, listMyHiddenSeens);
router.delete("/hidden-seens/:seenId", protect, showHiddenSeenAgain);
router.get("/notifications", protect, getMyNotificationSettings);
router.patch("/notifications", protect, updateMyNotificationSettings);
router.get("/account", protect, getMyAccountSettings);
router.patch("/account", protect, updateMyAccountSettings);

export default router;
