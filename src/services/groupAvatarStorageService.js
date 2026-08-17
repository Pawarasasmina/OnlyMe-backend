import { v2 as cloudinary } from "cloudinary";
import ApiError from "../utils/ApiError.js";
import { env } from "../config/env.js";

cloudinary.config({ cloud_name: env.cloudinaryCloudName, api_key: env.cloudinaryApiKey, api_secret: env.cloudinaryApiSecret, secure: true });

export async function uploadGroupAvatar({ buffer, groupId, userId }) {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) throw new ApiError(503, "Group-image storage is not configured");
  if (!buffer?.length) throw new ApiError(400, "A group image is required");
  const asset = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: "image",
      folder: `onlyme/messages/groups/${groupId}`,
      public_id: "avatar",
      overwrite: true,
      invalidate: true,
      transformation: [{ width: 512, height: 512, crop: "fill", gravity: "auto" }, { quality: "auto", fetch_format: "auto" }],
      context: { purpose: "group_avatar", uploaded_by: String(userId) },
    }, (error, result) => error ? reject(error) : resolve(result));
    stream.end(buffer);
  }).catch((error) => { throw new ApiError(502, error.message || "Group-image upload failed"); });
  return asset.secure_url;
}

export async function deleteGroupAvatar(groupId) {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) throw new ApiError(503, "Group-image storage is not configured");
  await cloudinary.uploader.destroy(`onlyme/messages/groups/${groupId}/avatar`, { resource_type: "image", invalidate: true });
}
