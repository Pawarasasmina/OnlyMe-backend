import { Router } from "express";
import { callConfiguration, callHistory, getPaidCallOffer, requestPaidCall } from "../controllers/callController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();
router.use(protect, authorize("fan", "creator"));
router.get("/configuration", callConfiguration);
router.get("/history", callHistory);
router.get("/offers/:creatorId", getPaidCallOffer);
router.post("/requests/:creatorId", requestPaidCall);
export default router;
