import crypto from "node:crypto";
import IdentityVerification from "../models/IdentityVerification.js";
import { syncIdentity } from "../services/stripeIdentityService.js";

export function validStripeSignature(body, header, secret, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = header.split(",").map(part => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  if (!timestamp || !Number.isFinite(Number(timestamp)) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest();
  return parts.filter(([key]) => key === "v1").some(([, value]) => {
    const actual = Buffer.from(value || "", "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}

export async function stripeIdentityWebhook(req, res, next) {
  if (!validStripeSignature(req.body, req.headers["stripe-signature"], process.env.STRIPE_IDENTITY_WEBHOOK_SECRET)) return res.status(400).json({ message: "Invalid Stripe signature" });
  try {
    const event = JSON.parse(req.body.toString("utf8"));
    if (event.type?.startsWith("identity.verification_session.")) {
      const record = await IdentityVerification.findOne({ sessionId: event.data?.object?.id });
      if (record) await syncIdentity(record);
    }
    return res.json({ received: true });
  } catch (error) { return next(error); }
}
