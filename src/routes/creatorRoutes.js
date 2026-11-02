import { Router } from "express";
import {
  getCreatorByUsername,
  getCreatorDashboard,
  getGrowDashboard,
  getReferralInvitation,
  listCreators,
  getInvitationLanding,
  acceptInvitation,
} from "../controllers/creatorController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { requireApprovedCreator } from "../middleware/creatorApprovalMiddleware.js";

const router = Router();

router.get("/dashboard", protect, authorize("fan", "creator"), requireApprovedCreator, getCreatorDashboard);
router.get("/grow", protect, authorize("fan", "creator"), requireApprovedCreator, getGrowDashboard);
router.get("/referrals/:code", getReferralInvitation);
router.get("/referrals/:code/landing", protect, getInvitationLanding);
router.post("/referrals/:code/join", protect, acceptInvitation);
router.get("/", listCreators);
router.get("/:username", getCreatorByUsername);

export default router;



