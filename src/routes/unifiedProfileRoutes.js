import { Router } from "express";
import { getOrbitCreators, getOwnProfileConnections, getOwnProfileViewers, getOwnUnifiedProfile, getProfileConnections, getUnifiedProfileByUsername, reportUnifiedProfile, toggleProfileFollow, toggleProfileSeeSignal } from "../controllers/unifiedProfileController.js";
import { optionalProtect, protect } from "../middleware/authMiddleware.js";

const router = Router();
router.get("/me", protect, getOwnUnifiedProfile);
router.get("/me/connections", protect, getOwnProfileConnections);
router.get("/me/viewers", protect, getOwnProfileViewers);
router.get("/orbit", protect, getOrbitCreators);
router.put("/:username/follow", protect, toggleProfileFollow);
router.put("/:username/see-signal", protect, toggleProfileSeeSignal);
router.post("/:username/report", protect, reportUnifiedProfile);
router.get("/:username/connections", optionalProtect, getProfileConnections);
router.get("/:username", optionalProtect, getUnifiedProfileByUsername);
export default router;
