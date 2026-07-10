import { Router } from "express";
import { getAdminDashboard } from "../controllers/adminController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.get("/dashboard", protect, authorize("admin"), getAdminDashboard);

export default router;
