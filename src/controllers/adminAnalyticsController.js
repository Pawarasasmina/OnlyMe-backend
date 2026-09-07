import { exportAdminAnalytics, getAdminAnalytics } from "../services/adminAnalyticsService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";

export const getAnalyticsReport = asyncHandler(async (req, res) => {
  const report = await getAdminAnalytics(req.query);
  return sendResponse(res, 200, "Admin analytics fetched", report);
});

export const exportAnalyticsReport = asyncHandler(async (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  const exported = await exportAdminAnalytics(req.query);

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=onlyme-analytics-report.csv");
    return res.status(200).send(exported);
  }
  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=onlyme-analytics-report.pdf");
    return res.status(200).send(exported);
  }

  return sendResponse(res, 200, "Admin analytics export generated", exported);
});
