import { Router } from "express";
import { toggleRepost } from "../controllers/repostController.js";
import { protect } from "../middleware/authMiddleware.js";
const router = Router();
router.put("/:kind/:id", protect, toggleRepost);
export default router;
