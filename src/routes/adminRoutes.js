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
  getReportForModeration,
  listReportedMessageUsers,
} from "../controllers/adminController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { createGift, deleteGift, listGifts, reorderGifts, updateGift } from "../controllers/adminGiftController.js";
import { uploadGiftImage } from "../middleware/uploadMiddleware.js";
import { getWelcomeEmailTemplate, updateWelcomeEmailTemplate } from "../controllers/adminEmailTemplateController.js";

const router = Router();
const messageReportScope = (req, _res, next) => { req.reportScopes = ["MESSAGE", "GROUP_MESSAGE", "CONVERSATION"]; next(); };
const userReportScope = (req, _res, next) => { req.reportScopes = ["PROFILE"]; next(); };
const postReportScope = (req, _res, next) => { req.reportScopes = ["FEED_POST", "SEEN"]; next(); };

router.use(protect, authorize("admin"));
router.get("/dashboard", getAdminDashboard);
router.get("/email-templates/welcome", getWelcomeEmailTemplate);
router.patch("/email-templates/welcome", uploadGiftImage.single("logo"), updateWelcomeEmailTemplate);
router.get("/gifts", listGifts);
router.post("/gifts", uploadGiftImage.single("image"), createGift);
router.patch("/gifts/reorder", reorderGifts);
router.patch("/gifts/:id", uploadGiftImage.single("image"), updateGift);
router.delete("/gifts/:id", deleteGift);
router.get("/users", listUsers);
router.patch("/users/:userId/status", updateUserStatus);
router.patch("/users/:userId/creator-approval", updateCreatorApproval);
router.get("/message-reports", messageReportScope, listMessageReports);
router.get("/message-reports/:reportId", messageReportScope, getReportForModeration);
router.get("/message-report-users", messageReportScope, listReportedMessageUsers);
router.get("/message-report-users/:userId", messageReportScope, getReportedMessageUser);
router.post("/message-reports/:reportId/review", messageReportScope, startMessageReportReview);
router.post("/message-reports/:reportId/resolve", messageReportScope, resolveMessageReport);
router.get("/user-report-users", userReportScope, listReportedMessageUsers);
router.get("/user-reports", userReportScope, listMessageReports);
router.get("/user-reports/:reportId", userReportScope, getReportForModeration);
router.get("/user-report-users/:userId", userReportScope, getReportedMessageUser);
router.post("/user-reports/:reportId/review", userReportScope, startMessageReportReview);
router.post("/user-reports/:reportId/resolve", userReportScope, resolveMessageReport);
router.get("/post-report-users", postReportScope, listReportedMessageUsers);
router.get("/post-reports", postReportScope, listMessageReports);
router.get("/post-reports/:reportId", postReportScope, getReportForModeration);
router.get("/post-report-users/:userId", postReportScope, getReportedMessageUser);
router.post("/post-reports/:reportId/review", postReportScope, startMessageReportReview);
router.post("/post-reports/:reportId/resolve", postReportScope, resolveMessageReport);
router.get("/content", listContentForModeration);
router.patch("/content/:contentId/status", updateContentStatus);

export default router;
