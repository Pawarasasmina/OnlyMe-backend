import { Router } from "express";
import {
  deleteVerificationFile,
  completeSellerInformation,
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
router.use(protect, authorize("fan", "creator"));
router.get("/", getMyVerification);
router.put("/seller-information", completeSellerInformation);
router.put("/draft", saveVerificationDraft);
router.put("/identity/draft", (req, _res, next) => { req.verificationPurpose = "IDENTITY"; next(); }, saveVerificationDraft);
router.post("/upload/:documentType", uploadVerificationDocument.single("document"), uploadVerificationFile);
router.delete("/upload/:documentType", deleteVerificationFile);
router.post("/submit", submitVerification);
router.post("/resubmit", resubmitVerification);
router.get("/document/:documentType", streamMyVerificationFile);

export default router;
