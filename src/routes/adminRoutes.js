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
  bulkUpdateUsers,
} from "../controllers/adminController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { createGift, createGiftCategory, deleteGift, deleteGiftCategory, listGifts, reorderGifts, updateGift, updateGiftCategory } from "../controllers/adminGiftController.js";
import { uploadGiftImage } from "../middleware/uploadMiddleware.js";
import { getWelcomeEmailTemplate, updateWelcomeEmailTemplate } from "../controllers/adminEmailTemplateController.js";
import { activateRecommendationConfig, createRecommendationDraft, getRecommendationSettings, resetRecommendationConfig } from "../controllers/adminRecommendationController.js";
import { requireAdminRole } from "../middleware/adminPermissionMiddleware.js";
import { createAdminStaff, listAdminStaff, resetAdminPassword, updateAdminStaff } from "../controllers/adminStaffController.js";

const router = Router();
const messageReportScope = (req, _res, next) => { req.reportScopes = ["MESSAGE", "GROUP_MESSAGE", "CONVERSATION"]; next(); };
const userReportScope = (req, _res, next) => { req.reportScopes = ["PROFILE"]; next(); };
const postReportScope = (req, _res, next) => { req.reportScopes = ["FEED_POST", "COMMENT", "SEEN", "CHAPTER", "WORLD", "STORY", "GIFT", "DIRECT_ACCESS"]; next(); };

router.use(protect, authorize("admin"));
router.get("/staff", requireAdminRole("MAIN_ADMIN"), listAdminStaff);
router.post("/staff", requireAdminRole("MAIN_ADMIN"), createAdminStaff);
router.patch("/staff/:id", requireAdminRole("MAIN_ADMIN"), updateAdminStaff);
router.post("/staff/:id/reset-password", requireAdminRole("MAIN_ADMIN"), resetAdminPassword);
router.use(requireAdminRole("MAIN_ADMIN", "MODERATOR"));
router.get("/dashboard", getAdminDashboard);
router.get("/recommendations", requireAdminRole("MAIN_ADMIN"), getRecommendationSettings);
router.post("/recommendations/drafts", requireAdminRole("MAIN_ADMIN"), createRecommendationDraft);
router.post("/recommendations/:id/activate", requireAdminRole("MAIN_ADMIN"), activateRecommendationConfig);
router.post("/recommendations/reset", requireAdminRole("MAIN_ADMIN"), resetRecommendationConfig);
router.get("/email-templates/welcome", requireAdminRole("MAIN_ADMIN"), getWelcomeEmailTemplate);
router.patch("/email-templates/welcome", requireAdminRole("MAIN_ADMIN"), uploadGiftImage.single("logo"), updateWelcomeEmailTemplate);
router.get("/gifts", requireAdminRole("MAIN_ADMIN"), listGifts);
router.post("/gift-categories", requireAdminRole("MAIN_ADMIN"), createGiftCategory);
router.patch("/gift-categories/:id", requireAdminRole("MAIN_ADMIN"), updateGiftCategory);
router.delete("/gift-categories/:id", requireAdminRole("MAIN_ADMIN"), deleteGiftCategory);
router.post("/gifts", requireAdminRole("MAIN_ADMIN"), uploadGiftImage.single("image"), createGift);
router.patch("/gifts/reorder", requireAdminRole("MAIN_ADMIN"), reorderGifts);
router.patch("/gifts/:id", requireAdminRole("MAIN_ADMIN"), uploadGiftImage.single("image"), updateGift);
router.delete("/gifts/:id", requireAdminRole("MAIN_ADMIN"), deleteGift);
router.get("/users", listUsers);
router.patch("/users/bulk", bulkUpdateUsers);
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
