import { Router } from "express";
import {
  checkUsernameAvailability,
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

const router = Router();

router.get("/username-availability", checkUsernameAvailability);
router.get("/me", protect, getMyProfile);
router.patch("/me", protect, updateMyProfile);
router.get("/me/completion", protect, getMyProfileCompletion);
router.post("/me/avatar", protect, uploadProfileImage.single("avatar"), uploadMyAvatar);
router.delete("/me/avatar", protect, removeMyAvatar);
router.post("/me/cover", protect, uploadCoverImage.single("cover"), uploadMyCover);
router.delete("/me/cover", protect, removeMyCover);

export default router;
