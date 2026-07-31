import { Router } from "express";
import {
  getOnboarding,
  getOnboardingChecklist,
  getSuggestions,
  postChecklistDismiss,
  postChecklistEvent,
  postComplete,
  postSkip,
  putChecklist,
  putInstincts,
  putInterests,
  putPeople,
  putWelcome,
} from "../controllers/onboardingController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";

const router = Router();

router.use(protect, authorize("fan", "creator", "admin"));

router.get("/", getOnboarding);
router.put("/welcome", putWelcome);
router.put("/interests", putInterests);
router.put("/instincts", putInstincts);
router.get("/suggestions", getSuggestions);
router.get("/suggested-people", getSuggestions);
router.put("/people", putPeople);
router.post("/follow", putPeople);
router.put("/checklist", putChecklist);
router.post("/complete", postComplete);
router.post("/skip", postSkip);
router.get("/checklist", getOnboardingChecklist);
router.post("/checklist/events", postChecklistEvent);
router.post("/checklist/dismiss", postChecklistDismiss);

export default router;
