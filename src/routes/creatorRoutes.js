import { Router } from "express";
import {
  getCreatorByUsername,
  getCreatorDashboard,
  getGrowDashboard,
  getReferralInvitation,
  listCreators,
} from "../controllers/creatorController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { requireApprovedCreator } from "../middleware/creatorApprovalMiddleware.js";

const router = Router();

router.get("/dashboard", protect, authorize("fan", "creator"), requireApprovedCreator, getCreatorDashboard);
router.get("/grow", protect, authorize("fan", "creator"), requireApprovedCreator, getGrowDashboard);
router.get("/referrals/:code", getReferralInvitation);
router.get("/", listCreators);
router.get("/:username", getCreatorByUsername);

export default router;



