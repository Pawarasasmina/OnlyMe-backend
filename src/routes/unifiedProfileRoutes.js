import { Router } from "express";
import { getOrbitCreators, getOwnUnifiedProfile, getUnifiedProfileByUsername } from "../controllers/unifiedProfileController.js";
import { optionalProtect, protect } from "../middleware/authMiddleware.js";

const router = Router();
router.get("/me", protect, getOwnUnifiedProfile);
router.get("/orbit", protect, getOrbitCreators);
router.get("/:username", optionalProtect, getUnifiedProfileByUsername);
export default router;
