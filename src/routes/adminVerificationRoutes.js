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

const router = Router();
router.use(protect, authorize("admin"));
router.get("/", listCreatorVerifications);
router.get("/:id", getCreatorVerification);
router.get("/:id/document/:documentType", streamAdminVerificationFile);
router.post("/:id/approve", approveCreatorVerification);
router.post("/:id/request-changes", requestCreatorVerificationChanges);
router.post("/:id/reject", rejectCreatorVerification);
router.get("/:id/history", getCreatorVerificationHistory);

export default router;
