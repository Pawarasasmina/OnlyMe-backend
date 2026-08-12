import { Router } from "express";
import {
  getAdminDashboard,
  listContentForModeration,
  listUsers,
  updateContentStatus,
  updateCreatorApproval,
  updateUserStatus,
  listMessageReports,
  resolveMessageReport,
  startMessageReportReview,
  getReportedMessageUser,
  listReportedMessageUsers,
} from "../controllers/adminController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { createGift, deleteGift, listGifts, reorderGifts, updateGift } from "../controllers/adminGiftController.js";
import { uploadGiftImage } from "../middleware/uploadMiddleware.js";

const router = Router();

router.use(protect, authorize("admin"));
router.get("/dashboard", getAdminDashboard);
router.get("/gifts", listGifts);
router.post("/gifts", uploadGiftImage.single("image"), createGift);
router.patch("/gifts/reorder", reorderGifts);
router.patch("/gifts/:id", uploadGiftImage.single("image"), updateGift);
router.delete("/gifts/:id", deleteGift);
router.get("/users", listUsers);
router.patch("/users/:userId/status", updateUserStatus);
router.patch("/users/:userId/creator-approval", updateCreatorApproval);
router.get("/message-reports", listMessageReports);
router.get("/message-report-users", listReportedMessageUsers);
router.get("/message-report-users/:userId", getReportedMessageUser);
router.post("/message-reports/:reportId/review", startMessageReportReview);
router.post("/message-reports/:reportId/resolve", resolveMessageReport);
router.get("/content", listContentForModeration);
router.patch("/content/:contentId/status", updateContentStatus);

export default router;
