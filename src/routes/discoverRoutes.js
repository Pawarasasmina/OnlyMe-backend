import { Router } from "express";
import {
  blockDiscoverCreator,
  getDiscover,
  hideDiscoverCreator,
  reportDiscoverCreator,
  resetDiscoverSettings,
  toggleDiscoverOfferSave,
  updateDiscoverSettings,
} from "../controllers/discoverController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.use(protect, authorize("fan", "creator"));
router.get("/", getDiscover);
router.patch("/settings", updateDiscoverSettings);
router.post("/settings/reset", resetDiscoverSettings);
router.post("/hidden-creators/:userId", hideDiscoverCreator);
router.put("/offers/:publicationId/save", toggleDiscoverOfferSave);
router.post("/creators/:userId/report", reportDiscoverCreator);
router.put("/creators/:userId/block", blockDiscoverCreator);

export default router;
