import { Router } from "express";
import { getCreatorDashboard } from "../controllers/creatorController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.get("/dashboard", protect, authorize("creator"), getCreatorDashboard);

export default router;
