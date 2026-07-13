import { Router } from "express";
import {
  getAdminDashboard,
  listContentForModeration,
  listUsers,
  updateContentStatus,
  updateCreatorApproval,
  updateUserStatus,
} from "../controllers/adminController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.use(protect, authorize("admin"));
router.get("/dashboard", getAdminDashboard);
router.get("/users", listUsers);
router.patch("/users/:userId/status", updateUserStatus);
router.patch("/users/:userId/creator-approval", updateCreatorApproval);
router.get("/content", listContentForModeration);
router.patch("/content/:contentId/status", updateContentStatus);

export default router;
