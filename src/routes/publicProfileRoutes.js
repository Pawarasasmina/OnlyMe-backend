import { Router } from "express";
import { getPublicCreatorProfile, getPublicFanProfile } from "../controllers/profileController.js";

const router = Router();

router.get("/creators/:username", getPublicCreatorProfile);
router.get("/fans/:username", getPublicFanProfile);

export default router;
