import { Router } from "express";
import {
  getUploadSignature,
  listContent,
  listMyContent,
  publishImageContent,
} from "../controllers/contentController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { requireApprovedCreator } from "../middleware/creatorApprovalMiddleware.js";

const router = Router();

router.get("/", listContent);
router.get("/mine", protect, authorize("creator"), requireApprovedCreator, listMyContent);
router.get("/creator/:creatorId", listContent);
router.post("/upload-signature", protect, authorize("creator"), requireApprovedCreator, getUploadSignature);
router.post("/image", protect, authorize("creator"), requireApprovedCreator, publishImageContent);

export default router;
