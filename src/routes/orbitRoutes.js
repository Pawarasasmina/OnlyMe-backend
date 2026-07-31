import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createOrbitSignal,
  getOrbit,
  getOrbitCityProgress,
  getSentOrbitSignals,
} from "../controllers/orbitController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();
const sharedOrbitAccess = [protect, authorize("fan", "creator")];
const signalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/", ...sharedOrbitAccess, getOrbit);
router.get("/cities", ...sharedOrbitAccess, getOrbitCityProgress);
router.get("/signals/sent", ...sharedOrbitAccess, getSentOrbitSignals);
router.post("/signals", ...sharedOrbitAccess, signalLimiter, createOrbitSignal);

export default router;
