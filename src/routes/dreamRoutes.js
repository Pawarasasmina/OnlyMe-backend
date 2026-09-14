import { Router } from "express";
import { completeMine, getDream, giftDream, removeMine, removeMinePhoto, uploadMinePhoto, upsertMine } from "../controllers/dreamController.js";
import { uploadProfileImage } from "../middleware/uploadMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { requireApprovedCreator } from "../middleware/creatorApprovalMiddleware.js";

const router = Router();
router.get("/creator/:username", getDream);
router.put("/mine", protect, authorize("fan", "creator"), requireApprovedCreator, upsertMine);
router.post("/mine/:id/photo", protect, authorize("fan", "creator"), requireApprovedCreator, uploadProfileImage.single("photo"), uploadMinePhoto);
router.delete("/mine/:id/photo", protect, authorize("fan", "creator"), requireApprovedCreator, removeMinePhoto);
router.post("/mine/:id/complete", protect, authorize("fan", "creator"), requireApprovedCreator, completeMine);
router.delete("/mine/:id", protect, authorize("fan", "creator"), requireApprovedCreator, removeMine);
router.post("/:id/gifts", protect, authorize("fan", "creator"), giftDream);
export default router;
