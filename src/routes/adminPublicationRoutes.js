import { Router } from "express";
import { approve, getHistory, getModeration, listModeration, reject, requestChanges } from "../controllers/adminPublicationController.js";
import { requireAdminRole } from "../middleware/adminPermissionMiddleware.js";
import { protect } from "../middleware/authMiddleware.js"; import { authorize } from "../middleware/roleMiddleware.js";
const router = Router(); router.use(protect, authorize("admin"), requireAdminRole("MAIN_ADMIN", "MODERATOR")); router.get("/", listModeration); router.get("/:id", getModeration); router.get("/:id/history", getHistory); router.post("/:id/approve", approve); router.post("/:id/request-changes", requestChanges); router.post("/:id/reject", reject); export default router;
