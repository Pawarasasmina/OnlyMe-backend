import { Router } from "express";
import { deactivateAccount, getAccountOwnership, deleteAccount, forgotPassword, getMe, googleCallback, googleLogin, login, logout, refreshSession, register, resetPassword, updateProfileType } from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);
router.get("/google", googleLogin);
router.get("/google/callback", googleCallback);
router.post("/logout", logout);
router.post("/refresh", refreshSession);
router.get("/me", protect, getMe);
router.put("/profile-type", protect, updateProfileType);
router.delete("/account", protect, deleteAccount);
router.get("/account/ownership", protect, getAccountOwnership);
router.post("/account/deactivate", protect, deactivateAccount);

export default router;
