import { Router } from "express";
import { getSavedOverview, listSavedCategory, listSavedContent } from "../controllers/savedController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();
router.get("/overview", protect, authorize("fan", "creator"), getSavedOverview);
router.get("/:category", protect, authorize("fan", "creator"), listSavedCategory);
router.get("/", protect, authorize("fan", "creator"), listSavedContent);
export default router;
