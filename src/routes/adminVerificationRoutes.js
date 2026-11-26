import { Router } from "express";
import {
  approveCreatorVerification,
  getCreatorVerification,
  getCreatorVerificationHistory,
  listCreatorVerifications,
  rejectCreatorVerification,
  requestCreatorVerificationChanges,
  streamAdminVerificationFile,
} from "../controllers/adminVerificationController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { requireAdminPermission, requireIdentityReviewAccess } from "../middleware/adminPermissionMiddleware.js";

const router = Router();
router.use(protect, authorize("admin"));
router.use(requireIdentityReviewAccess);
router.get("/", requireAdminPermission("verification.view"), listCreatorVerifications);
router.get("/:id", requireAdminPermission("verification.view"), getCreatorVerification);
router.get("/:id/document/:documentType", requireAdminPermission("verification.view"), streamAdminVerificationFile);
router.post("/:id/approve", requireAdminPermission("verification.manage"), approveCreatorVerification);
router.post("/:id/request-changes", requireAdminPermission("verification.manage"), requestCreatorVerificationChanges);
router.post("/:id/reject", requireAdminPermission("verification.manage"), rejectCreatorVerification);
router.get("/:id/history", requireAdminPermission("verification.view"), getCreatorVerificationHistory);

export default router;
