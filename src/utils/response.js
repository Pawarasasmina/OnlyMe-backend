import { privateResponse } from "../services/responsePrivacyService.js";

export async function sendResponse(res, statusCode, message, data = {}) {
  return res.status(statusCode).json({
    success: statusCode < 400,
    message,
    data: await privateResponse(data, res.req?.user?._id),
  });
}
