import { Router } from "express";
import { receiveUploadSafetyFlag } from "../controllers/uploadSafetyWebhookController.js";
const router = Router(); router.post("/flags", receiveUploadSafetyFlag); export default router;
