import { Router } from "express";
import { purchase, thankSeenCreator } from "../controllers/purchaseController.js";
import { protect } from "../middleware/authMiddleware.js";
import { financialMutationLimit } from "../middleware/financialRateLimit.js";

const router = Router();
router.post("/:publicationId/purchase", protect, financialMutationLimit, purchase);
router.post("/:publicationId/thanks", protect, thankSeenCreator);
export default router;
