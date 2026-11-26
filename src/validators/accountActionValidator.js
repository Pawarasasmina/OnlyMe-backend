import ApiError from "../utils/ApiError.js";

export function requireAccountAction(body) {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 500) throw new ApiError(400, "A reason between 3 and 500 characters is required");
  if (body.confirmed !== true) throw new ApiError(400, "Confirm the account action before submitting");
  return reason;
}
