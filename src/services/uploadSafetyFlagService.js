import MessageReport from "../models/MessageReport.js";

// Scanner adapters call this after persisting an upload. It deliberately stores
// the scanner evidence rather than a live content reference alone.
export async function createUploadSafetyFlag({ author, category, confidence, provider, scope, snapshot, target = {} }) {
  return MessageReport.create({
    reporter: null,
    reportedUser: author,
    scope,
    source: "UPLOAD_SCAN",
    reason: String(category || "OTHER").toUpperCase(),
    details: `Automatic upload flag${provider ? ` from ${provider}` : ""}${confidence == null ? "" : ` (${Math.round(Number(confidence) * 100)}% confidence)`}`,
    snapshot: { ...snapshot, scan: { provider: provider || "configured-scanner", confidence: confidence ?? null, flaggedAt: new Date() } },
    ...target,
  });
}
