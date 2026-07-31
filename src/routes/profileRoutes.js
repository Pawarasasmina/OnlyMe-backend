import { Router } from "express";
import {
  checkUsernameAvailability,
  changeMyPassword,
  getMyAccountSettings,
  getMyNotificationSettings,
  getMyProfile,
  getMyProfileCompletion,
  getMyPrivacySettings,
  removeMyAvatar,
  removeMyCover,
  updateMyAccountSettings,
  updateMyNotificationSettings,
  updateMyProfile,
  updateMyPrivacySettings,
  uploadMyAvatar,
  uploadMyCover,
} from "../controllers/profileController.js";
import { optionalProtect, protect } from "../middleware/authMiddleware.js";
import { uploadCoverImage, uploadProfileImage } from "../middleware/uploadMiddleware.js";

const router = Router();

router.get("/username-availability", optionalProtect, checkUsernameAvailability);
router.get("/me", protect, getMyProfile);
router.patch("/me", protect, updateMyProfile);
router.patch("/me/password", protect, changeMyPassword);
router.get("/me/completion", protect, getMyProfileCompletion);
router.get("/settings/privacy", protect, getMyPrivacySettings);
router.patch("/settings/privacy", protect, updateMyPrivacySettings);
router.get("/settings/notifications", protect, getMyNotificationSettings);
router.patch("/settings/notifications", protect, updateMyNotificationSettings);
router.get("/settings/account", protect, getMyAccountSettings);
router.patch("/settings/account", protect, updateMyAccountSettings);
router.post("/me/avatar", protect, uploadProfileImage.single("avatar"), uploadMyAvatar);
router.delete("/me/avatar", protect, removeMyAvatar);
router.post("/me/cover", protect, uploadCoverImage.single("cover"), uploadMyCover);
router.delete("/me/cover", protect, removeMyCover);

export default router;



