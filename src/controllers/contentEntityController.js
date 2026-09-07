import { getEntityDetail, searchEntities } from "../services/contentEntityService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const searchContentEntities = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Attached entities fetched", await searchEntities({
    limit: req.query.limit,
    q: req.query.q,
    type: req.query.type,
    user: req.user,
  }));
});

export const getContentEntity = asyncHandler(async (req, res) => {
  return sendResponse(res, 200, "Attached entity fetched", await getEntityDetail({
    id: req.params.id,
    type: req.params.type,
    user: req.user,
  }));
});
