import { Router } from "express";
import { approve, getHistory, getModeration, listModeration, reject, requestChanges } from "../controllers/adminPublicationController.js";
import { requireAdminPermission } from "../middleware/adminPermissionMiddleware.js";
import { protect } from "../middleware/authMiddleware.js"; import { authorize } from "../middleware/roleMiddleware.js";
const router = Router(); router.use(protect, authorize("admin")); router.get("/", requireAdminPermission("moderation.view"), listModeration); router.get("/:id", requireAdminPermission("moderation.view"), getModeration); router.get("/:id/history", requireAdminPermission("moderation.view"), getHistory); router.post("/:id/approve", requireAdminPermission("moderation.manage"), approve); router.post("/:id/request-changes", requireAdminPermission("moderation.manage"), requestChanges); router.post("/:id/reject", requireAdminPermission("moderation.manage"), reject); export default router;
