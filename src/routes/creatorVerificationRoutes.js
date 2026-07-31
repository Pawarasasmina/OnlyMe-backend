import { Router } from "express";
import {
  deleteVerificationFile,
  getMyVerification,
  resubmitVerification,
  saveVerificationDraft,
  streamMyVerificationFile,
  submitVerification,
  uploadVerificationFile,
} from "../controllers/creatorVerificationController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { uploadVerificationDocument } from "../middleware/verificationUploadMiddleware.js";

const router = Router();
router.use(protect, authorize("creator"));
router.get("/", getMyVerification);
router.put("/draft", saveVerificationDraft);
router.post("/upload/:documentType", uploadVerificationDocument.single("document"), uploadVerificationFile);
router.delete("/upload/:documentType", deleteVerificationFile);
router.post("/submit", submitVerification);
router.post("/resubmit", resubmitVerification);
router.get("/document/:documentType", streamMyVerificationFile);

export default router;
