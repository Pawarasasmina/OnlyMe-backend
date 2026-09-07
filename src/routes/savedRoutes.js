import { Router } from "express";
import {
  getSavedOverview,
  listSavedCategory,
  listSavedContent,
  saveBook,
  saveComment,
  saveJourney,
  savePlace,
  unsaveBook,
  unsaveComment,
  unsaveJourney,
  unsavePlace,
} from "../controllers/savedController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();
router.get("/overview", protect, authorize("fan", "creator"), getSavedOverview);
router.post("/places/:placeId", protect, authorize("fan", "creator"), savePlace);
router.delete("/places/:placeId", protect, authorize("fan", "creator"), unsavePlace);
router.post("/journeys/:journeyId", protect, authorize("fan", "creator"), saveJourney);
router.delete("/journeys/:journeyId", protect, authorize("fan", "creator"), unsaveJourney);
router.post("/books/:bookId", protect, authorize("fan", "creator"), saveBook);
router.delete("/books/:bookId", protect, authorize("fan", "creator"), unsaveBook);
router.post("/comments/:commentId", protect, authorize("fan", "creator"), saveComment);
router.delete("/comments/:commentId", protect, authorize("fan", "creator"), unsaveComment);
router.get("/:category", protect, authorize("fan", "creator"), listSavedCategory);
router.get("/", protect, authorize("fan", "creator"), listSavedContent);
export default router;
