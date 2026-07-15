import { Router } from "express";
import {
  getCreatorByUsername,
  getCreatorDashboard,
  listCreators,
} from "../controllers/creatorController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.get("/dashboard", protect, authorize("creator"), getCreatorDashboard);
router.get("/", listCreators);
router.get("/:username", getCreatorByUsername);

export default router;



