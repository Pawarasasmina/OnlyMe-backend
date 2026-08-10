import { Router } from "express";
import { completeMine, getDream, giftDream, removeMine, upsertMine } from "../controllers/dreamController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { requireApprovedCreator } from "../middleware/creatorApprovalMiddleware.js";

const router = Router();
router.get("/creator/:username", getDream);
router.put("/mine", protect, authorize("creator"), requireApprovedCreator, upsertMine);
router.post("/mine/:id/complete", protect, authorize("creator"), requireApprovedCreator, completeMine);
router.delete("/mine/:id", protect, authorize("creator"), requireApprovedCreator, removeMine);
router.post("/:id/gifts", protect, authorize("fan", "creator"), giftDream);
export default router;
