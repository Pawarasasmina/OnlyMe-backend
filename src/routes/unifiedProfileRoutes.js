import { Router } from "express";
import { getOrbitCreators, getOwnProfileConnections, getOwnUnifiedProfile, getUnifiedProfileByUsername, toggleProfileFollow, toggleProfileSeeSignal } from "../controllers/unifiedProfileController.js";
import { optionalProtect, protect } from "../middleware/authMiddleware.js";

const router = Router();
router.get("/me", protect, getOwnUnifiedProfile);
router.get("/me/connections", protect, getOwnProfileConnections);
router.get("/orbit", protect, getOrbitCreators);
router.put("/:username/follow", protect, toggleProfileFollow);
router.put("/:username/see-signal", protect, toggleProfileSeeSignal);
router.get("/:username", optionalProtect, getUnifiedProfileByUsername);
export default router;
