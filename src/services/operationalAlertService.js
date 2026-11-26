import BusinessBooking from "../models/BusinessBooking.js";
import MessageReport from "../models/MessageReport.js";
import OperationalAlert from "../models/OperationalAlert.js";
import Payout from "../models/Payout.js";
import PublicationReport from "../models/PublicationReport.js";
import { alertSettings, sendTelegram } from "./alertSettingsService.js";

const windowKey = (type, now, minutes) => `${type}:${Math.floor(now.getTime() / (minutes * 60000))}`;
async function deliverOnce(type, eventKey, message) {
  if (await OperationalAlert.exists({ eventKey })) return false;
  const settings = await alertSettings(); if (!settings.enabled || !settings.ownerChatId || !settings.tokenConfigured) return false;
  try { const providerId = await sendTelegram({ chatId: settings.ownerChatId, text: message }); await OperationalAlert.create({ type, eventKey, message, status: "DELIVERED", providerId }); }
  catch (error) { await OperationalAlert.create({ type, eventKey, message, status: "FAILED", error: String(error?.message || error).slice(0, 1000) }).catch(() => {}); }
  return true;
}
export async function sendOwnerOperationalAlert(type, eventKey, message) { return deliverOnce(type, eventKey, message); }
export async function processOperationalAlerts(now = new Date()) {
  const settings = await alertSettings(); if (!settings.enabled) return { checked: false };
  const reportSince = new Date(now.getTime() - settings.reportSpikeMinutes * 60000);
  const disputeSince = new Date(now.getTime() - settings.chargebackSpikeMinutes * 60000);
  const [messageReports, publicationReports, disputes, payoutFailures] = await Promise.all([
    MessageReport.countDocuments({ createdAt: { $gte: reportSince }, source: "USER_REPORT" }), PublicationReport.countDocuments({ createdAt: { $gte: reportSince }, source: "USER_REPORT" }),
    BusinessBooking.countDocuments({ "dispute.openedAt": { $gte: disputeSince } }), Payout.find({ status: "FAILED", updatedAt: { $gte: new Date(now.getTime() - 24 * 3600000) } }).select("_id usdAmount failureReason updatedAt").lean(),
  ]);
  const reports = messageReports + publicationReports;
  if (reports >= settings.reportSpikeThreshold) await deliverOnce("REPORT_SPIKE", windowKey("REPORT_SPIKE", now, settings.reportSpikeMinutes), `📈 @seen report spike\n${reports} new reports in ${settings.reportSpikeMinutes} minutes.\nOpen owner dashboard: ${process.env.CLIENT_URL || ""}/admin/safety`);
  if (disputes >= settings.chargebackSpikeThreshold) await deliverOnce("CHARGEBACK_SPIKE", windowKey("CHARGEBACK_SPIKE", now, settings.chargebackSpikeMinutes), `⚠️ @seen payment-dispute spike\n${disputes} new disputes in ${settings.chargebackSpikeMinutes} minutes.\nReview the admin operations dashboard.`);
  if (payoutFailures.length >= settings.payoutFailureThreshold) for (const payout of payoutFailures) await deliverOnce("PAYOUT_FAILURE", `PAYOUT_FAILURE:${payout._id}`, `💸 @seen payout failure\nPayout ID: ${payout._id}\nAmount: $${Number(payout.usdAmount).toFixed(2)}\nReview: ${process.env.CLIENT_URL || ""}/admin/payouts`);
  return { checked: true, reports, disputes, payoutFailures: payoutFailures.length };
}
