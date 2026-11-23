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
import { createGift, createGiftCategory, deleteGift, deleteGiftCategory, listGifts, reorderGiftCategories, reorderGifts, updateGift, updateGiftCategory } from "../controllers/adminGiftController.js";
import { uploadGiftImage } from "../middleware/uploadMiddleware.js";
import { getWelcomeEmailTemplate, updateWelcomeEmailTemplate } from "../controllers/adminEmailTemplateController.js";
import { activateRecommendationConfig, createRecommendationDraft, getRecommendationSettings, resetRecommendationConfig } from "../controllers/adminRecommendationController.js";
import { requireAdminPermission, requireAdminRole } from "../middleware/adminPermissionMiddleware.js";
import { getAdminRolePolicies, getMyAdminAccess, updateAdminRolePolicy } from "../controllers/adminPermissionController.js";
import { createAdminStaff, deleteTestAdminStaff, listAdminStaff, resetAdminPassword, updateAdminStaff, updateRoleTwoFactor, updateStaffTwoFactor } from "../controllers/adminStaffController.js";
import { cancelCreatorAnnouncement, createCreatorAnnouncement, getCreatorAnnouncement, getCreatorAnnouncementOptions, listCreatorAnnouncements, previewCreatorAnnouncementAudience } from "../controllers/adminCreatorAnnouncementController.js";

const router = Router();
const messageReportScope = (req, _res, next) => { req.reportScopes = ["MESSAGE", "GROUP_MESSAGE", "CONVERSATION"]; next(); };
const userReportScope = (req, _res, next) => { req.reportScopes = ["PROFILE"]; next(); };
const postReportScope = (req, _res, next) => { req.reportScopes = ["FEED_POST", "COMMENT", "SEEN", "CHAPTER", "WORLD", "STORY", "GIFT", "DIRECT_ACCESS"]; next(); };

router.use(protect, authorize("admin"));
router.get("/access/me", getMyAdminAccess);
router.get("/access/roles", requireAdminRole("MAIN_ADMIN"), getAdminRolePolicies);
router.put("/access/roles/:role", requireAdminRole("MAIN_ADMIN"), updateAdminRolePolicy);
router.get("/staff", requireAdminRole("MAIN_ADMIN"), listAdminStaff);
router.post("/staff", requireAdminRole("MAIN_ADMIN"), createAdminStaff);
router.post("/staff/2fa-policy", requireAdminRole("MAIN_ADMIN"), updateRoleTwoFactor);
router.patch("/staff/:id", requireAdminRole("MAIN_ADMIN"), updateAdminStaff);
router.post("/staff/:id/reset-password", requireAdminRole("MAIN_ADMIN"), resetAdminPassword);
router.post("/staff/:id/2fa", requireAdminRole("MAIN_ADMIN"), updateStaffTwoFactor);
router.delete("/staff/:id", requireAdminRole("MAIN_ADMIN"), deleteTestAdminStaff);
router.get("/dashboard", requireAdminPermission("dashboard.view"), getAdminDashboard);
router.get("/recommendations", requireAdminPermission("recommendations.manage"), getRecommendationSettings);
router.post("/recommendations/drafts", requireAdminPermission("recommendations.manage"), createRecommendationDraft);
router.post("/recommendations/:id/activate", requireAdminPermission("recommendations.manage"), activateRecommendationConfig);
router.post("/recommendations/reset", requireAdminPermission("recommendations.manage"), resetRecommendationConfig);
router.get("/email-templates/welcome", requireAdminPermission("welcome_email.manage"), getWelcomeEmailTemplate);
router.patch("/email-templates/welcome", requireAdminPermission("welcome_email.manage"), uploadGiftImage.single("logo"), updateWelcomeEmailTemplate);
router.get("/creator-announcements/options", requireAdminPermission("announcements.view"), getCreatorAnnouncementOptions);
router.post("/creator-announcements/preview", requireAdminPermission("announcements.manage"), previewCreatorAnnouncementAudience);
router.get("/creator-announcements", requireAdminPermission("announcements.view"), listCreatorAnnouncements);
router.post("/creator-announcements", requireAdminPermission("announcements.manage"), createCreatorAnnouncement);
router.get("/creator-announcements/:id", requireAdminPermission("announcements.view"), getCreatorAnnouncement);
router.post("/creator-announcements/:id/cancel", requireAdminPermission("announcements.manage"), cancelCreatorAnnouncement);
router.get("/gifts", requireAdminPermission("gifts.manage"), listGifts);
router.post("/gift-categories", requireAdminPermission("gifts.manage"), createGiftCategory);
router.patch("/gift-categories/reorder", requireAdminPermission("gifts.manage"), reorderGiftCategories);
router.patch("/gift-categories/:id", requireAdminPermission("gifts.manage"), updateGiftCategory);
router.delete("/gift-categories/:id", requireAdminPermission("gifts.manage"), deleteGiftCategory);
router.post("/gifts", requireAdminPermission("gifts.manage"), uploadGiftImage.single("image"), createGift);
router.patch("/gifts/reorder", requireAdminPermission("gifts.manage"), reorderGifts);
router.patch("/gifts/:id", requireAdminPermission("gifts.manage"), uploadGiftImage.single("image"), updateGift);
router.delete("/gifts/:id", requireAdminPermission("gifts.manage"), deleteGift);
router.get("/users", requireAdminPermission("users.view"), listUsers);
router.patch("/users/bulk", requireAdminPermission("users.manage"), bulkUpdateUsers);
router.patch("/users/:userId/status", requireAdminPermission("users.manage"), updateUserStatus);
router.patch("/users/:userId/creator-approval", requireAdminPermission("users.manage"), updateCreatorApproval);
router.get("/message-reports", requireAdminPermission("moderation.view"), messageReportScope, listMessageReports);
router.get("/message-reports/:reportId", requireAdminPermission("moderation.view"), messageReportScope, getReportForModeration);
router.get("/message-report-users", requireAdminPermission("moderation.view"), messageReportScope, listReportedMessageUsers);
router.get("/message-report-users/:userId", requireAdminPermission("moderation.view"), messageReportScope, getReportedMessageUser);
router.post("/message-reports/:reportId/review", requireAdminPermission("moderation.manage"), messageReportScope, startMessageReportReview);
router.post("/message-reports/:reportId/resolve", requireAdminPermission("moderation.manage"), messageReportScope, resolveMessageReport);
router.get("/user-report-users", requireAdminPermission("moderation.view"), userReportScope, listReportedMessageUsers);
router.get("/user-reports", requireAdminPermission("moderation.view"), userReportScope, listMessageReports);
router.get("/user-reports/:reportId", requireAdminPermission("moderation.view"), userReportScope, getReportForModeration);
router.get("/user-report-users/:userId", requireAdminPermission("moderation.view"), userReportScope, getReportedMessageUser);
router.post("/user-reports/:reportId/review", requireAdminPermission("moderation.manage"), userReportScope, startMessageReportReview);
router.post("/user-reports/:reportId/resolve", requireAdminPermission("moderation.manage"), userReportScope, resolveMessageReport);
router.get("/post-report-users", requireAdminPermission("moderation.view"), postReportScope, listReportedMessageUsers);
router.get("/post-reports", requireAdminPermission("moderation.view"), postReportScope, listMessageReports);
router.get("/post-reports/:reportId", requireAdminPermission("moderation.view"), postReportScope, getReportForModeration);
router.get("/post-report-users/:userId", requireAdminPermission("moderation.view"), postReportScope, getReportedMessageUser);
router.post("/post-reports/:reportId/review", requireAdminPermission("moderation.manage"), postReportScope, startMessageReportReview);
router.post("/post-reports/:reportId/resolve", requireAdminPermission("moderation.manage"), postReportScope, resolveMessageReport);
router.get("/content", requireAdminPermission("moderation.view"), listContentForModeration);
router.patch("/content/:contentId/status", requireAdminPermission("moderation.manage"), updateContentStatus);

export default router;
