import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import IdentityVerification from "../models/IdentityVerification.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { manualPayoutIdentityStatus } from "../services/manualBankService.js";
const router = Router();
router.use(protect);
router.get("/admin", authorize("admin"), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const [items, total] = await Promise.all([
    IdentityVerification.find().select("user status verifiedAt errorCode payoutsEnabled sealRevokedAt sealRevocationReason history updatedAt").sort({ updatedAt: -1 }).skip((page - 1) * 30).limit(30).populate("user", "name username email isVerified").lean(),
    IdentityVerification.countDocuments(),
  ]);
  return sendResponse(res, 200, "Identity verifications", { items, total, page });
}));
router.post("/admin/:id/seal", authorize("admin"), asyncHandler(async (req, res) => {
  const { active, reason } = req.body;
  if (typeof active !== "boolean" || typeof reason !== "string" || reason.trim().length < 5 || reason.length > 1000) throw new ApiError(400, "Provide a reason of 5–1000 characters");
  const record = await IdentityVerification.findById(req.params.id);
  if (!record || record.status !== "verified") throw new ApiError(400, "Only provider-verified accounts can have a seal restored or revoked");
  record.sealRevokedAt = active ? null : new Date();
  record.sealRevokedBy = req.user._id;
  record.sealRevocationReason = reason.trim();
  record.history.push({ action: active ? "SEAL_RESTORED" : "SEAL_REVOKED", by: req.user._id, reason: reason.trim() });
  await record.save();
  await User.updateOne({ _id: record.user }, { $set: { isVerified: active } });
  return sendResponse(res, 200, "Verification seal updated", { active });
}));
router.get("/", asyncHandler(async (req, res) => sendResponse(res, 200, "Verification status", await manualPayoutIdentityStatus(req.user))));
router.post("/start", asyncHandler(async () => { throw new ApiError(410, "Use the in-app identity application for admin review"); }));
export default router;
