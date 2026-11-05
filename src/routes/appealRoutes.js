import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { submitAppeal } from "../controllers/adminOperationsController.js";
import { disputeDirectAccess } from "../controllers/reportingController.js";
const router = Router();
router.use(protect);
router.post("/", submitAppeal);
router.post("/direct-access/:id", disputeDirectAccess);
export default router;
