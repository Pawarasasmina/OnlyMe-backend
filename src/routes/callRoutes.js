import { Router } from "express";
import { callConfiguration, callHistory, getPaidCallOffer, requestCallReschedule, requestPaidCall, schedulePaidCall } from "../controllers/callController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();
router.use(protect, authorize("fan", "creator"));
router.get("/configuration", callConfiguration);
router.get("/history", callHistory);
router.get("/offers/:creatorId", getPaidCallOffer);
router.post("/requests/:creatorId", requestPaidCall);
router.patch("/requests/:callId/schedule", schedulePaidCall);
router.post("/requests/:callId/reschedule", requestCallReschedule);
export default router;
