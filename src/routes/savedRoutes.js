import { Router } from "express";
import { listSavedContent } from "../controllers/savedController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();
router.get("/", protect, authorize("fan", "creator"), listSavedContent);
export default router;
