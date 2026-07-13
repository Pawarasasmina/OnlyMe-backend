import { Router } from "express";
import {
  checkUsernameAvailability,
  changeMyPassword,
  getMyProfile,
  getMyProfileCompletion,
  removeMyAvatar,
  removeMyCover,
  updateMyProfile,
  uploadMyAvatar,
  uploadMyCover,
} from "../controllers/profileController.js";
import { protect } from "../middleware/authMiddleware.js";
import { uploadCoverImage, uploadProfileImage } from "../middleware/uploadMiddleware.js";
import { requireApprovedCreator } from "../middleware/creatorApprovalMiddleware.js";

const router = Router();

router.get("/username-availability", checkUsernameAvailability);
router.get("/me", protect, getMyProfile);
router.patch("/me", protect, requireApprovedCreator, updateMyProfile);
router.patch("/me/password", protect, changeMyPassword);
router.get("/me/completion", protect, getMyProfileCompletion);
router.post("/me/avatar", protect, requireApprovedCreator, uploadProfileImage.single("avatar"), uploadMyAvatar);
router.delete("/me/avatar", protect, requireApprovedCreator, removeMyAvatar);
router.post("/me/cover", protect, requireApprovedCreator, uploadCoverImage.single("cover"), uploadMyCover);
router.delete("/me/cover", protect, requireApprovedCreator, removeMyCover);

export default router;
