import EmailTemplate from "../models/EmailTemplate.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/response.js";
import { deleteGiftImage, uploadGiftImage } from "../services/giftImageStorageService.js";

const defaults = { key: "WELCOME" };
const fields = ["subject", "heading", "message", "buttonLabel", "footer"];
const limits = { subject: 160, heading: 160, message: 1200, buttonLabel: 80, footer: 500 };
const serialize = (template) => ({ id: template._id, subject: template.subject, heading: template.heading, message: template.message || "Your space is ready. Discover people, moments, and worlds that feel relevant to you.", buttonLabel: template.buttonLabel || "Start discovering", footer: template.footer, logoUrl: template.logo?.url || "", updatedAt: template.updatedAt });

async function getTemplate() {
  return EmailTemplate.findOneAndUpdate({ key: "WELCOME" }, { $setOnInsert: defaults }, { new: true, upsert: true, setDefaultsOnInsert: true });
}

export const getWelcomeEmailTemplate = asyncHandler(async (_req, res) => sendResponse(res, 200, "Welcome email template fetched", { template: serialize(await getTemplate()) }));

export const updateWelcomeEmailTemplate = asyncHandler(async (req, res) => {
  const template = await getTemplate();
  for (const field of fields) {
    if (req.body[field] === undefined) continue;
    const value = String(req.body[field]).trim();
    if (!value) throw new ApiError(400, `${field} is required`);
    if (value.length > limits[field]) throw new ApiError(400, `${field} is too long`);
    template[field] = value;
  }
  const previousAssetId = template.logo?.assetId;
  let uploaded;
  if (req.file) uploaded = await uploadGiftImage(req.file, req.user._id);
  if (uploaded) template.logo = { assetId: uploaded.assetId, url: uploaded.url };
  if (String(req.body.removeLogo) === "true") template.logo = { assetId: "", url: "" };
  template.updatedBy = req.user._id;
  await template.save();
  if ((uploaded || String(req.body.removeLogo) === "true") && previousAssetId) await deleteGiftImage(previousAssetId).catch(() => {});
  return sendResponse(res, 200, "Welcome email template updated", { template: serialize(template) });
});
