import { Router } from "express";
import { recordShare, weeklySummary } from "../controllers/shareController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();
router.post("/", protect, recordShare);
router.get("/weekly-summary", protect, weeklySummary);
export default router;
