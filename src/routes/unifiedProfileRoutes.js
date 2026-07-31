import { Router } from "express";
import { getUnifiedMyProfile, getUnifiedPublicProfile } from "../controllers/profileController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/me", protect, getUnifiedMyProfile);
router.get("/:username", getUnifiedPublicProfile);

export default router;
