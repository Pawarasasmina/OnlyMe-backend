import { Router } from "express";
import rateLimit from "express-rate-limit";
import { listVoiceTranslationLanguages, transcribeWallVoiceNote, translateWallVoiceTranscript } from "../controllers/voiceController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { uploadVoiceTranscription } from "../middleware/uploadMiddleware.js";

const router = Router();
const consumerOnly = [protect, authorize("fan", "creator")];
const voiceTranslationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    success: false,
    message: "Too many translation requests. Please wait a moment and try again.",
    data: {},
    code: "RATE_LIMITED",
  }),
  passOnStoreError: true,
});

router.post("/transcribe", ...consumerOnly, uploadVoiceTranscription.single("audio"), transcribeWallVoiceNote);
router.get("/translation-languages", ...consumerOnly, listVoiceTranslationLanguages);
router.post("/translate", voiceTranslationLimiter, ...consumerOnly, translateWallVoiceTranscript);

export default router;
