import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, getTwoFactorStatus } from "../controllers/adminSecurityController.js";
const router = Router(); router.use(protect, authorize("admin")); router.get("/2fa", getTwoFactorStatus); router.post("/2fa/setup", beginTwoFactorSetup); router.post("/2fa/confirm", confirmTwoFactorSetup); router.post("/2fa/disable", disableTwoFactor); export default router;
