import crypto from"node:crypto";import ApiError from"../utils/ApiError.js";import{FINANCIAL_ERROR_CODES}from"../constants/financialConstants.js";
export function positiveStars(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new ApiError(400,"Stars amount must be a positive integer","INVALID_STARS_AMOUNT");return n}
export function idempotencyKey(value){const key=String(value||"").trim();if(!/^[A-Za-z0-9._:-]{8,200}$/.test(key))throw new ApiError(400,"A valid idempotencyKey is required","INVALID_IDEMPOTENCY_KEY");return key}
export function requiredReason(value){const reason=String(value||"").trim();if(reason.length<3||reason.length>500)throw new ApiError(400,"A reason between 3 and 500 characters is required","INVALID_REASON");return reason}
export function fingerprint(value){return crypto.createHash("sha256").update(JSON.stringify(value,Object.keys(value).sort())).digest("hex")}
export const financialConflict=(message,code=FINANCIAL_ERROR_CODES.IDEMPOTENCY_CONFLICT)=>new ApiError(409,message,code);
