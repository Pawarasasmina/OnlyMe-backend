import AdminAuditEvent from "../models/AdminAuditEvent.js";
import { effectiveAdminRole } from "../middleware/adminPermissionMiddleware.js";

// Never deliver a document when its durable audit write fails.
export async function auditDocumentView(req, stream, targetType, targetId, documentType) {
  try {
    await AdminAuditEvent.create({
      actor: req.user._id,
      actorRole: effectiveAdminRole(req.user),
      action: "VERIFICATION_DOCUMENT_VIEWED",
      targetType,
      targetId: String(targetId),
      reason: "Verification document review",
      metadata: { documentType, ip: req.ip, userAgent: String(req.get("User-Agent") || "").slice(0, 300) },
    });
  } catch (error) {
    stream.destroy();
    throw error;
  }
}
