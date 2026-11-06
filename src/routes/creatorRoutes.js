import { Router } from "express";
import {
  getCreatorByUsername,
  getCreatorDashboard,
  getWaysToEarnDashboard,
  getGrowDashboard,
  getReferralInvitation,
  listCreators,
  getInvitationLanding,
  acceptInvitation,
} from "../controllers/creatorController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { requireApprovedCreator } from "../middleware/creatorApprovalMiddleware.js";
import { profileAccountType } from "../constants/profileCategoryConstants.js";

function requireDashboardAccess(req, res, next) {
  if (["creator", "business"].includes(profileAccountType(req.user))) return next();
  return requireApprovedCreator(req, res, next);
}

const router = Router();

router.get("/dashboard", protect, authorize("fan", "creator"), requireDashboardAccess, getCreatorDashboard);
router.get("/ways-to-earn", protect, authorize("fan", "creator"), getWaysToEarnDashboard);
router.get("/grow", protect, authorize("fan", "creator"), requireDashboardAccess, getGrowDashboard);
router.get("/referrals/:code", getReferralInvitation);
router.get("/referrals/:code/landing", protect, getInvitationLanding);
router.post("/referrals/:code/join", protect, acceptInvitation);
router.get("/", listCreators);
router.get("/:username", getCreatorByUsername);

export default router;



