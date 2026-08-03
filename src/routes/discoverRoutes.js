import { Router } from "express";
import { getDiscover, resetDiscoverSettings, updateDiscoverSettings } from "../controllers/discoverController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.use(protect, authorize("fan", "creator"));
router.get("/", getDiscover);
router.patch("/settings", updateDiscoverSettings);
router.post("/settings/reset", resetDiscoverSettings);

export default router;
