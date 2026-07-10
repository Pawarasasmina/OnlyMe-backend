import { Router } from "express";
import { getCurrentUser } from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/me", protect, getCurrentUser);

export default router;
