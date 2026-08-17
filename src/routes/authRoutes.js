import { Router } from "express";
import { deleteAccount, getMe, login, logout, refreshSession, register } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh", refreshSession);
router.get("/me", protect, getMe);
router.delete("/account", protect, deleteAccount);

export default router;
