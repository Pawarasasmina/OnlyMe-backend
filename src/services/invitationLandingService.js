import mongoose from "mongoose";
import InvitationFan from "../models/InvitationFan.js";
import Publication from "../models/Publication.js";
import Referral from "../models/Referral.js";
import User from "../models/User.js";
import { resolveReferral } from "./referralService.js";
import { createFollowRelationship } from "./profileRelationshipService.js";

const sequenceSchema = new mongoose.Schema({ _id: String, value: Number });
const Sequence = mongoose.models.InvitationFanSequence || mongoose.model("InvitationFanSequence", sequenceSchema);

async function invitationOwner(code) {
  const invitation = await resolveReferral(code);
  const owner = await User.findOne({ username: invitation.inviter.username, status: "active" }).select("_id").lean();
  return { invitation, owner };
}

export async function invitationLanding(code, actor) {
  const { invitation, owner } = await invitationOwner(code);
  const [referrals, fans, publications] = await Promise.all([
    Referral.distinct("invitee", { inviter: owner._id }),
    InvitationFan.distinct("fan", { inviter: owner._id }),
    Publication.find({ creator: owner._id, kind: "SEEN", status: "PUBLISHED", visibility: "PUBLIC" })
      .sort({ publishedAt: -1, _id: -1 }).limit(2).select("publishedSnapshot").lean(),
  ]);
  const joinedCount = new Set([...referrals, ...fans].map(String)).size;
  const previews = publications.flatMap(row => {
    const metadata = row.publishedSnapshot?.metadata;
    if (!metadata?.coverMedia?.secureUrl) return [];
    return [{ id: String(row._id), title: metadata.title || "Seen", coverUrl: metadata.coverMedia.secureUrl,
      resourceType: metadata.coverMedia.resourceType }];
  });
  const [existing, sequence] = await Promise.all([
    actor ? InvitationFan.findOne({ inviter: owner._id, fan: actor._id }).lean() : null,
    Sequence.findById(String(owner._id)).lean(),
  ]);
  return { ...invitation, joinedCount, previews, fanNumber: existing?.number || Math.max(sequence?.value || 0, referrals.length) + 1 };
}

export async function joinInvitation(code, actor) {
  const { invitation, owner } = await invitationOwner(code);
  // Explicit creation is idempotent and enforces account/block restrictions.
  await createFollowRelationship({ actor, targetUserId: owner._id });
  let fan = await InvitationFan.findOne({ inviter: owner._id, fan: actor._id }).lean();
  if (!fan) {
    const baseline = await Referral.countDocuments({ inviter: owner._id });
    try { await Sequence.updateOne({ _id: String(owner._id) }, { $setOnInsert: { value: baseline } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    const sequence = await Sequence.findOneAndUpdate({ _id: String(owner._id) }, { $inc: { value: 1 } }, { new: true });
    try { fan = await InvitationFan.create({ inviter: owner._id, fan: actor._id, number: sequence.value, type: invitation.type }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      fan = await InvitationFan.findOne({ inviter: owner._id, fan: actor._id }).lean();
      if (!fan) throw error;
    }
  }
  const [referralFriends, joinedFriends] = await Promise.all([
    Referral.distinct("invitee", { inviter: owner._id, type: "friend" }),
    InvitationFan.distinct("fan", { inviter: owner._id, type: "friend" }),
  ]);
  const friendIds = [...new Set([...referralFriends, ...joinedFriends].map(String))];
  if (await User.countDocuments({ _id: { $in: friendIds }, status: "active" }) >= 3) {
    await User.updateOne({ _id: owner._id, friendInviteRingEarnedAt: null }, { $set: { friendInviteRingEarnedAt: new Date() } });
  }
  return { username: invitation.inviter.username, number: fan.number };
}
