import { Router } from "express";
import { getContentEntity, searchContentEntities } from "../controllers/contentEntityController.js";
import { optionalProtect, protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.get("/search", protect, authorize("fan", "creator"), searchContentEntities);
router.get("/:type/:id", optionalProtect, getContentEntity);

export default router;
