import { sendMembershipCancellationReceipt } from "../services/membershipReceiptService.js";
import{joinPremium,cancelPremium,resumePremium,cancelWorldWaitlist,getWorldWaitlistStatus}from"../services/premiumMembershipService.js";import{asyncHandler}from"../utils/asyncHandler.js";import{sendResponse}from"../utils/response.js";export const join=asyncHandler(async(req,res)=>{const data=await joinPremium({user:req.user,publicationId:req.params.publicationId,key:req.body.idempotencyKey});return sendResponse(res,200,data.queued?"Added to World waiting list":"Premium membership joined",data)});export const waitingStatus=asyncHandler(async(req,res)=>sendResponse(res,200,"Waiting-list status fetched",{waitingList:await getWorldWaitlistStatus(req.user._id,req.params.publicationId)}));export const cancelWaiting=asyncHandler(async(req,res)=>sendResponse(res,200,"Waiting-list reservation cancelled",await cancelWorldWaitlist({user:req.user,publicationId:req.params.publicationId,key:req.body.idempotencyKey})));export const cancel=asyncHandler(async(req,res)=>{
  const data=await cancelPremium({user:req.user,membershipId:req.params.id,key:req.body.idempotencyKey});
  let receiptEmailSent=false;
  try { const receipt=await sendMembershipCancellationReceipt(req.user,data.membership); receiptEmailSent=Boolean(receipt.delivered); }
  catch { console.error("Membership cancellation receipt could not be delivered", { membershipId:req.params.id }); }
  return sendResponse(res,200,"Membership will cancel at period end",{...data,receiptEmailSent});
});
export const resume=asyncHandler(async(req,res)=>sendResponse(res,200,"Membership resumed",await resumePremium({user:req.user,membershipId:req.params.id,key:req.body.idempotencyKey})));
