import { Router } from "express";
import { listVoiceTranslationLanguages, transcribeWallVoiceNote, translateWallVoiceTranscript } from "../controllers/voiceController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { uploadVoiceTranscription } from "../middleware/uploadMiddleware.js";

const router = Router();
const consumerOnly = [protect, authorize("fan", "creator")];

router.post("/transcribe", ...consumerOnly, uploadVoiceTranscription.single("audio"), transcribeWallVoiceNote);
router.get("/translation-languages", ...consumerOnly, listVoiceTranslationLanguages);
router.post("/translate", ...consumerOnly, translateWallVoiceTranscript);

export default router;
