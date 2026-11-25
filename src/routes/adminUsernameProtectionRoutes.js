import { Router } from "express";
import { requireAdminPermission } from "../middleware/adminPermissionMiddleware.js";
import { actionUsernameAccount, createProtectedUsername, listProtectedUsernames, searchUsernameAccounts, updateProtectedUsername } from "../controllers/adminUsernameProtectionController.js";

const router = Router();
router.get("/username-protection", requireAdminPermission("moderation.view"), listProtectedUsernames);
router.post("/username-protection", requireAdminPermission("moderation.manage"), createProtectedUsername);
router.patch("/username-protection/:id", requireAdminPermission("moderation.manage"), updateProtectedUsername);
router.get("/username-protection/accounts", requireAdminPermission("moderation.view"), searchUsernameAccounts);
router.post("/username-protection/accounts/:id/action", requireAdminPermission("moderation.manage"), actionUsernameAccount);
export default router;
