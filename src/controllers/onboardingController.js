import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import {
  acknowledgeChecklist,
  completeOnboarding,
  dismissChecklist,
  getChecklist,
  getOnboardingState,
  getSuggestedPeople,
  recordChecklistEvent,
  saveInstincts,
  saveInterests,
  saveSuggestedPeople,
  saveWelcome,
  skipOnboarding,
} from "../services/onboardingService.js";
import {
  validateChecklistEvent,
  validateInstinctPreferences,
  validateInterestIds,
  validateSuggestedPeoplePayload,
} from "../validators/onboardingValidator.js";

export const getOnboarding = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Onboarding state fetched", await getOnboardingState(req.user));
});

export const putWelcome = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Welcome step saved", await saveWelcome(req.user));
});

export const putInterests = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Onboarding interests saved", await saveInterests(req.user, validateInterestIds(req.body)));
});

export const putInstincts = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Onboarding instincts saved", await saveInstincts(req.user, validateInstinctPreferences(req.body)));
});

export const getSuggestions = asyncHandler(async (req, res) => {
  const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 12));
  return sendResponse(res, 200, "Onboarding suggestions fetched", {
    suggestions: await getSuggestedPeople(req.user, { limit }),
  });
});

export const putPeople = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Onboarding people saved", await saveSuggestedPeople(req.user, validateSuggestedPeoplePayload(req.body)));
});

export const putChecklist = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Onboarding checklist acknowledged", await acknowledgeChecklist(req.user));
});

export const postComplete = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Onboarding completed", await completeOnboarding(req.user));
});

export const postSkip = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Onboarding skipped", await skipOnboarding(req.user));
});

export const getOnboardingChecklist = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Onboarding checklist fetched", await getChecklist(req.user));
});

export const postChecklistEvent = asyncHandler(async (req, res) => {
  const event = validateChecklistEvent(req.body);
  const updatedUser = await recordChecklistEvent(req.user._id, event);
  return sendResponse(res, 200, "Checklist progress updated", await getChecklist(updatedUser));
});

export const postChecklistDismiss = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Checklist dismissed", await dismissChecklist(req.user));
});
