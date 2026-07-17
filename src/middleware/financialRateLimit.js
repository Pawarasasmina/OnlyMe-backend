import rateLimit from "express-rate-limit";

const handler = (_req, res) => res.status(429).json({ success: false, message: "Too many financial requests. Retry shortly with the same action key.", code: "FINANCIAL_RATE_LIMITED", data: {} });
const base = { windowMs: 60 * 1000, standardHeaders: true, legacyHeaders: false, handler };

export const financialMutationLimit = rateLimit({ ...base, limit: 30 });
export const adminFinancialMutationLimit = rateLimit({ ...base, limit: 15 });
