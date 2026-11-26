import mongoose from "mongoose";
import BusinessVerification from "../models/BusinessVerification.js";
import { auditDocumentView } from "../services/adminDocumentAccessService.js";
import BusinessBooking from "../models/BusinessBooking.js";
import FeedPost from "../models/FeedPost.js";
import User from "../models/User.js";
import UserBlock from "../models/UserBlock.js";
import AdminAuditEvent from "../models/AdminAuditEvent.js";
import { profileAccountType } from "../constants/profileCategoryConstants.js";
import { businessVerified, requireVerifiedBusiness, validateBusinessOffer } from "../services/businessPolicyService.js";
import { wallClosedReason } from "../services/wallLifecycleService.js";
import { storeVerificationDocument, openVerificationDocument, setPrivateDocumentHeaders } from "../services/privateDocumentStorageService.js";
import { cleanupUnreferencedVerificationFile } from "../services/verificationFileCleanupService.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
export const businessControllerTestUtils = { storeVerificationDocument, cleanupUnreferencedVerificationFile };
const text = (value, max) => String(value || "").trim().slice(0, max);
const validId = value => { if (!mongoose.isValidObjectId(value)) throw new ApiError(400, "Invalid ID"); return value; };
const safeVerification = row => { if (!row) return null; const item = row.toObject ? row.toObject() : { ...row }; const doc = item.document; delete item.document; return { ...item, documentMetadata: doc ? { originalName: doc.originalName, mimeType: doc.mimeType, size: doc.size } : null, eligible: businessVerified(row), expired: new Date(row.expiresAt) <= new Date() }; };
const audit = (req, action, id, reason, after) => AdminAuditEvent.create({ actor: req.user._id, actorRole: req.adminRole, action, targetType: "BUSINESS", targetId: String(id), reason, after });

export const getMyBusiness = asyncHandler(async (req, res) => sendResponse(res, 200, "Business verification fetched", { verification: safeVerification(await BusinessVerification.findOne({ user: req.user._id }).lean()) }));
export const submitBusiness = asyncHandler(async (req, res) => {
  if (profileAccountType(req.user) !== "business") throw new ApiError(403, "Switch to a Business account first");
  const data = Object.fromEntries([["legalName",160],["country",80],["licenceNumber",100],["issuingAuthority",160]].map(([key,max]) => [key,text(req.body[key],max)]));
  if (Object.values(data).some(value => !value)) throw new ApiError(400, "Complete all business licence details");
  const documentType = req.body.documentType;
  if (!["TRADE_LICENCE", "LOCAL_EQUIVALENT"].includes(documentType)) throw new ApiError(400, "Choose a trade licence or local equivalent");
  if (["ae","uae","unitedarabemirates"].includes(data.country.toLowerCase().replace(/[^a-z]/g,"")) && documentType !== "TRADE_LICENCE") throw new ApiError(400, "UAE businesses require a trade licence");
  const rawDate = String(req.body.expiresAt || "");
  const expiry = new Date(`${rawDate}T23:59:59.999Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || !Number.isFinite(expiry.getTime()) || expiry.toISOString().slice(0,10) !== rawDate || expiry <= new Date()) throw new ApiError(400, "Enter a valid future licence expiry date");
  const previous = await BusinessVerification.findOne({ user: req.user._id }).select("+document");
  if (previous?.status === "PENDING") throw new ApiError(409, "Your business application is already awaiting review");
  const document = await businessControllerTestUtils.storeVerificationDocument(req.file, req.user._id);
  let updated;
  try {
    const values = { ...data, documentType, expiresAt: expiry, document, status: "PENDING", feedback: "", reviewedAt: null, reviewedBy: null };
    const event = { status: "PENDING", reason: "Business licence submitted", actor: req.user._id, at: new Date() };
    updated = previous ? await BusinessVerification.findOneAndUpdate({ _id: previous._id, __v: previous.__v, status: previous.status }, { $set: values, $push: { history: event }, $inc: { __v: 1 } }, { new: true, runValidators: true }) : await BusinessVerification.create({ user: req.user._id, ...values, history: [event] });
    if (!updated) throw new ApiError(409, "Application changed; reload and retry");
  } catch (error) { await businessControllerTestUtils.cleanupUnreferencedVerificationFile(document.storageKey, "business_upload_conflict"); throw error; }
  if (previous?.document?.storageKey) await businessControllerTestUtils.cleanupUnreferencedVerificationFile(previous.document.storageKey, "business_document_replaced");
  return sendResponse(res, 201, "Business licence submitted for review", { verification: safeVerification(updated) });
});
export const listBusinessApplications = asyncHandler(async (req, res) => {
  const filter = {};
  if (["PENDING","APPROVED","REJECTED","CHANGES_REQUESTED","REVOKED"].includes(req.query.status)) filter.status = req.query.status;
  const rows = await BusinessVerification.find(filter).select("+document").populate("user", "name username email profileAccountType profileType status").populate("reviewedBy", "name username").sort({ updatedAt: -1 }).limit(200).lean();
  return sendResponse(res, 200, "Business applications fetched", { items: rows.map(safeVerification) });
});
export const reviewBusiness = asyncHandler(async (req, res) => {
  const id = validId(req.params.id), status = req.body.status;
  if (!["APPROVED","REJECTED","CHANGES_REQUESTED","REVOKED"].includes(status)) throw new ApiError(400, "Invalid business review decision");
  const reason = text(req.body.reason,2000);
  if (reason.length < 3) throw new ApiError(400, "Enter a review reason");
  const current = await BusinessVerification.findById(id).select("+document");
  if (!current) throw new ApiError(404, "Business application not found");
  if (status === "REVOKED" ? current.status !== "APPROVED" : current.status !== "PENDING") throw new ApiError(409, "This application is not available for that decision");
  if (status === "APPROVED") {
    const owner = await User.findById(current.user);
    if (!owner || owner.status !== "active" || profileAccountType(owner) !== "business") throw new ApiError(409, "The applicant must have an active Business account");
    if (!current.document?.storageKey || current.expiresAt <= new Date()) throw new ApiError(400, "A current business licence is required");
    if (req.body.documentReviewed !== true || req.body.detailsMatch !== true) throw new ApiError(400, "Review the licence and confirm the business details match");
  }
  const updated = await BusinessVerification.findOneAndUpdate({ _id: id, status: current.status, __v: current.__v }, { $set: { status, feedback: reason, reviewedAt: new Date(), reviewedBy: req.user._id }, $push: { history: { status, reason, actor: req.user._id, at: new Date() } }, $inc: { __v: 1 } }, { new: true, runValidators: true });
  if (!updated) throw new ApiError(409, "Application changed; reload and retry");
  await audit(req, `BUSINESS_${status}`, id, reason, { status });
  return sendResponse(res, 200, "Business review saved", { verification: safeVerification(updated) });
});
export const streamBusinessDocument = asyncHandler(async (req, res) => {
  const row = await BusinessVerification.findById(validId(req.params.id)).select("+document");
  if (!row?.document) throw new ApiError(404, "Business document not found");
  const stream = await openVerificationDocument(row.document.storageKey);
  await auditDocumentView(req, stream, "BUSINESS_VERIFICATION", row._id, "document");
  setPrivateDocumentHeaders(res,row.document);
  stream.on("error", error => res.destroy(error)); stream.pipe(res);
});
export const listMyBookings = asyncHandler(async (req, res) => sendResponse(res, 200, "Bookings fetched", { items: await BusinessBooking.find({ $or: [{ customer: req.user._id }, { business: req.user._id }] }).populate("customer business", "name username").sort({ createdAt: -1 }).limit(200).lean() }));
export const createBooking = asyncHandler(async (req, res) => {
  const offer = await FeedPost.findById(validId(req.body.offerId)).lean();
  if (!offer || !offer.businessOffer || offer.status !== "published" || offer.visibility !== "public" || offer.deletedAt || offer.moderationHiddenAt || ["PENDING_REVIEW","REJECTED"].includes(offer.moderationStatus) || wallClosedReason(offer)) throw new ApiError(404, "Active business offer not found");
  const business = await User.findById(offer.author);
  await requireVerifiedBusiness(business); validateBusinessOffer(offer);
  if (String(offer.author) === String(req.user._id)) throw new ApiError(400, "You cannot book your own business");
  if (await UserBlock.exists({ $or: [{ blocker: req.user._id, blocked: offer.author }, { blocker: offer.author, blocked: req.user._id }] })) throw new ApiError(403, "Booking is unavailable");
  const scheduledAt = new Date(req.body.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date()) throw new ApiError(400, "Choose a future booking date and time");
  let item;
  try { item = await BusinessBooking.create({ offer: offer._id, business: offer.author, customer: req.user._id, service: offer.text.slice(0,160), price: offer.price, currency: offer.currency, scheduledAt }); } catch (error) { if (error.code === 11000) throw new ApiError(409,"You already requested this offer at this time"); throw error; }
  return sendResponse(res,201,"Booking requested; the business must confirm availability",{ item });
});
export const updateBooking = asyncHandler(async (req,res) => {
  const item = await BusinessBooking.findOne({ _id: validId(req.params.id), $or: [{ customer: req.user._id }, { business: req.user._id }] });
  if (!item) throw new ApiError(404,"Booking not found");
  const status = req.body.status, owner = String(item.business) === String(req.user._id);
  if (status === "CANCELLED" && !["REQUESTED","CONFIRMED"].includes(item.status) || status === "CONFIRMED" && (!owner || item.status !== "REQUESTED") || status === "COMPLETED" && (!owner || item.status !== "CONFIRMED") || !["CANCELLED","CONFIRMED","COMPLETED"].includes(status)) throw new ApiError(409,"Invalid booking transition");
  if (status === "COMPLETED" && item.scheduledAt > new Date()) throw new ApiError(409,"A booking cannot be marked completed before its scheduled time");
  if (status !== "CANCELLED") await requireVerifiedBusiness(req.user);
  const updated = await BusinessBooking.findOneAndUpdate({ _id:item._id, status:item.status },{$set:{status}},{new:true});
  if (!updated) throw new ApiError(409,"Booking changed; reload and retry");
  return sendResponse(res,200,"Booking updated",{item:updated});
});
export const disputeBooking = asyncHandler(async (req,res) => {
  const reason = text(req.body.reason,2000); if(reason.length<3) throw new ApiError(400,"Describe the booking dispute");
  const item = await BusinessBooking.findOneAndUpdate({ _id:validId(req.params.id), $or:[{customer:req.user._id},{business:req.user._id}], status:{$in:["REQUESTED","CONFIRMED","COMPLETED","CANCELLED"]}, "dispute.openedAt":null },{$set:{status:"DISPUTED",dispute:{reason,openedBy:req.user._id,openedAt:new Date()}}},{new:true});
  if(!item) throw new ApiError(409,"Booking unavailable or a dispute was already submitted");
  return sendResponse(res,201,"Booking dispute sent to the support inbox",{item});
});
export const supportInbox = asyncHandler(async (req,res) => {
  const filter = { status:"DISPUTED", "dispute.resolvedAt": req.query.resolved === "true" ? {$ne:null} : null };
  return sendResponse(res,200,"Support inbox fetched",{items:await BusinessBooking.find(filter).populate("business customer", "name username email").sort({"dispute.openedAt":-1}).limit(200).lean()});
});
export const resolveBookingDispute = asyncHandler(async (req,res) => {
  const resolution = text(req.body.resolution,2000); if(resolution.length<3) throw new ApiError(400,"Enter the support resolution");
  const item = await BusinessBooking.findOneAndUpdate({_id:validId(req.params.id),status:"DISPUTED","dispute.resolvedAt":null},{$set:{"dispute.resolution":resolution,"dispute.resolvedBy":req.user._id,"dispute.resolvedAt":new Date()}},{new:true});
  if(!item) throw new ApiError(409,"Open booking dispute not found");
  await audit(req,"BOOKING_DISPUTE_RESOLVED",item._id,resolution,{resolved:true});
  return sendResponse(res,200,"Booking dispute resolved",{item});
});

export const listBusinessOffers = asyncHandler(async (_req,res) => {
  const businesses = await User.find({ $or:[{profileAccountType:"business"},{profileAccountType:{$in:[null,""]},profileType:"business"}] }).select("_id").lean();
  const items = await FeedPost.find({ $or:[{businessOffer:true},{author:{$in:businesses.map(row=>row._id)},postType:{$in:["Offering","Buy & Sell"]}}],deletedAt:null }).select("author text price currency status moderationStatus moderationHiddenAt moderationReason businessOffer offerRulesAcceptedAt createdAt").populate("author","name username").sort({createdAt:-1}).limit(200).lean();
  return sendResponse(res,200,"Business offers fetched",{items});
});
export const moderateBusinessOffer = asyncHandler(async (req,res) => {
  const reason=text(req.body.reason,2000);
  if (reason.length<3 || typeof req.body.hidden !== "boolean") throw new ApiError(400,"Choose a moderation action and enter a reason");
  const post=await FeedPost.findById(validId(req.params.id));
  const owner=post ? await User.findById(post.author) : null;
  if (!post || post.deletedAt || !["Offering","Buy & Sell"].includes(post.postType) || !post.businessOffer && (!owner || profileAccountType(owner)!=="business")) throw new ApiError(404,"Business offer not found");
  if (!req.body.hidden) { await requireVerifiedBusiness(owner); validateBusinessOffer(post); }
  post.moderationHiddenAt=req.body.hidden ? new Date() : null;
  post.moderationStatus=req.body.hidden ? "REJECTED" : "APPROVED";
  post.moderationReason=reason;
  post.visibility=req.body.hidden ? "private" : "public";
  await post.save();
  await audit(req,req.body.hidden?"BUSINESS_OFFER_HIDDEN":"BUSINESS_OFFER_RESTORED",post._id,reason,{hidden:req.body.hidden});
  return sendResponse(res,200,"Business offer review saved",{id:post._id});
});
