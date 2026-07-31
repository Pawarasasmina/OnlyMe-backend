import { Router } from "express";
import {
  clearRecent,
  defaults,
  recent,
  removeRecent,
  search,
  searchRateLimit,
  suggestions,
  trending,
} from "../controllers/searchController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.use(protect, searchRateLimit);
router.get("/", search);
router.get("/defaults", defaults);
router.get("/suggestions", suggestions);
router.get("/recent", recent);
router.delete("/recent/:id", removeRecent);
router.delete("/recent", clearRecent);
router.get("/trending", trending);

export default router;
