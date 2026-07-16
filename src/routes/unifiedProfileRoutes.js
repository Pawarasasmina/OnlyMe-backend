import { Router } from "express";
import { getOwnUnifiedProfile, getUnifiedProfileByUsername } from "../controllers/unifiedProfileController.js";
import { optionalProtect, protect } from "../middleware/authMiddleware.js";

const router = Router();
router.get("/me", protect, getOwnUnifiedProfile);
router.get("/:username", optionalProtect, getUnifiedProfileByUsername);
export default router;
