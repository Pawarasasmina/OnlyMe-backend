import crypto from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import ApiError from "../utils/ApiError.js";

cloudinary.config({cloud_name:env.cloudinaryCloudName,api_key:env.cloudinaryApiKey,api_secret:env.cloudinaryApiSecret,secure:true});
const scopes = new Set(["MESSAGE", "CONVERSATION", "GROUP_MESSAGE"]);

export async function freezeMessageEvidence(snapshot, reportId) {
  const frozenAt = new Date();
  const copies = new Map();
  const copy = async (row) => {
    const result = {...row};
    for (const kind of ["image", "audio", "video"]) {
      const media = row[kind];
      if (!media?.assetId) continue;
      const resourceType = kind === "image" ? "image" : "video";
      const key = `${resourceType}:${media.assetId}`;
      if (!copies.has(key)) {
        const source = cloudinary.url(media.assetId,{secure:true,sign_url:true,type:"authenticated",resource_type:resourceType,format:media.format || undefined});
        let asset;
        try {
          asset = await cloudinary.uploader.upload(source,{
            public_id:`atseen/private/report-evidence/${reportId}/${crypto.randomUUID()}`,
            resource_type:resourceType,type:"authenticated",overwrite:false,
            context:{purpose:"frozen_report_evidence",report:String(reportId)},
          });
        } catch {
          throw new ApiError(502,"Could not preserve the reported media. Please retry the report.","EVIDENCE_CAPTURE_FAILED");
        }
        copies.set(key,{...media,assetId:asset.public_id,resourceType,format:asset.format || media.format,bytes:asset.bytes,sourceAssetId:media.assetId,providerEtag:asset.etag,frozenAt});
      }
      result[kind] = {...copies.get(key)};
    }
    for (const field of ["messages","context"]) if (Array.isArray(row[field])) {
      result[field] = [];
      for (const item of row[field]) result[field].push(await copy(item));
    }
    return result;
  };
  try {
    return {...await copy(snapshot),frozenAt,evidenceVersion:1};
  } catch (error) {
    await Promise.allSettled([...copies.values()].map(media=>cloudinary.uploader.destroy(media.assetId,{resource_type:media.resourceType,type:"authenticated",invalidate:true})));
    throw error;
  }
}

export function withMessageEvidenceUrls(report) {
  const result = typeof report?.toObject === "function" ? report.toObject() : {...report};
  if (!scopes.has(result.scope) || !result.snapshot) return result;
  const enrich = row => {
    const item = {...row};
    for (const kind of ["image","audio","video"]) if (row[kind]?.assetId) item[kind] = {
      ...row[kind],url:cloudinary.url(row[kind].assetId,{secure:true,sign_url:true,type:"authenticated",resource_type:kind === "image" ? "image" : "video",format:row[kind].format || undefined}),
    };
    for (const field of ["messages","context"]) if (Array.isArray(row[field])) item[field] = row[field].map(enrich);
    return item;
  };
  result.snapshot = enrich(result.snapshot);
  return result;
}

export const isMessageEvidenceScope = scope => scopes.has(scope);

export function messageEvidenceRow(message) {
  return {
    messageId:String(message._id),senderId:String(message.sender),
    ...(message.recipient ? {recipientId:String(message.recipient)} : {}),
    body:message.body,mediaType:message.mediaType,
    image:message.image,audio:message.audio,video:message.video,
    createdAt:message.createdAt,deletedAt:message.deletedAt,
    disappearAfterSeconds:message.disappearAfterSeconds ?? null,
    openedAt:message.openedAt,expiresAt:message.expiresAt,
  };
}
