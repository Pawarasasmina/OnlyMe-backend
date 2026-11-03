import { Router } from "express";
import mongoose from "mongoose";
import PayoutBankApplication from "../models/PayoutBankApplication.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { getManualBank, submitManualBank, reviewManualBank, serializeBank, decryptBankDetails } from "../services/manualBankService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { sendResponse } from "../utils/response.js";
const router = Router();
router.use(protect);
router.get("/bank", asyncHandler(async (req, res) => sendResponse(res, 200, "Bank application fetched", await getManualBank(req.user._id))));
router.post("/bank", asyncHandler(async (req, res) => sendResponse(res, 200, "Bank details submitted for admin review", { bank: await submitManualBank(req.user, req.body) })));
router.get("/admin/banks", authorize("admin"), asyncHandler(async (req, res) => {
  const page = Math.min(1000000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
  const status = req.query.status;
  if (status && !["PENDING_REVIEW", "APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(status)) throw new ApiError(400, "Invalid bank status");
  const filter = status ? { status } : {};
  const [banks, total] = await Promise.all([PayoutBankApplication.find(filter).sort({ submittedAt: -1 }).skip((page - 1) * 30).limit(30).populate("user", "name username email").lean(), PayoutBankApplication.countDocuments(filter)]);
  return sendResponse(res, 200, "Bank applications fetched", { items: banks.map(bank => ({ ...serializeBank(bank), user: bank.user ? { id: bank.user._id, name: bank.user.name, username: bank.user.username, email: bank.user.email } : null })), page, total });
}));
router.get("/admin/banks/:id", authorize("admin"), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, "Invalid application ID");
  const bank = await PayoutBankApplication.findById(req.params.id).select("+encryptedDetails").populate("user", "name username email");
  if (!bank) throw new ApiError(404, "Bank application not found");
  const details = decryptBankDetails(bank.encryptedDetails);
  await PayoutBankApplication.updateOne({ _id: bank._id }, { $push: { history: { action: "DETAILS_VIEWED", by: req.user._id, at: new Date(), version: bank.version } } });
  res.set("Cache-Control", "no-store");
  return sendResponse(res, 200, "Bank details fetched", { bank: { ...serializeBank(bank), user: bank.user ? { id: bank.user._id, name: bank.user.name, username: bank.user.username } : null, ...details } });
}));
router.post("/admin/banks/:id/review", authorize("admin"), asyncHandler(async (req, res) => {
  const bank = await reviewManualBank(req.params.id, req.user._id, req.body);
  req.app.get("io")?.to(`user:${bank.user}`).emit("payout-bank:updated", { bankReady: bank.status === "APPROVED" });
  return sendResponse(res, 200, "Bank review saved", { bank: serializeBank(bank) });
}));
router.put("/bank/automatic-payout", asyncHandler(async (req, res) => {
  if (typeof req.body.active !== "boolean") throw new ApiError(400, "Choose a monthly payout preference");
  const bank = await PayoutBankApplication.findOneAndUpdate({ user: req.user._id, status: "APPROVED" }, { $set: { automaticPayout: req.body.active } }, { new: true });
  if (!bank) throw new ApiError(409, "An admin must approve your bank first");
  return sendResponse(res, 200, "Monthly payout preference saved", { automaticPayout: bank.automaticPayout });
}));
export default router;
