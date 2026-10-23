import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import User from "../models/User.js";
import Referral from "../models/Referral.js";
import { referralCodes } from "../services/referralService.js";

const PEOPLE = [
  { name: "Anna Reed", username: "grow_anna_reed", photo: 47, type: "friend", hoursAgo: 2, earningsAmount: 8.41, coins: 990 },
  { name: "Omar Hale", username: "grow_omar_hale", photo: 12, type: "friend", hoursAgo: 5, earningsAmount: 4.16, coins: 490 },
  { name: "Mia Chen", username: "grow_mia_chen", photo: 32, type: "friend", hoursAgo: 24, earningsAmount: 12.58, coins: 1480 },
  { name: "Sofia Lane", username: "grow_sofia_lane", photo: 44, type: "creator", hoursAgo: 48, earningsAmount: 486, latestEarningAmount: 8.41, coins: 990 },
  { name: "Zoe Hart", username: "grow_zoe_hart", photo: 49, type: "friend", hoursAgo: 72, earningsAmount: 4.16, coins: 490 },
  { name: "James Cole", username: "grow_james_cole", photo: 11, type: "creator", hoursAgo: 24 * 21, earningsAmount: 1240, latestEarningAmount: 0, coins: 0 },
];

function avatarFor(person) {
  return `https://i.pravatar.cc/128?img=${person.photo}`;
}

async function run() {
  await connectDb();
  const maya = await User.findOne({ email: "maya@gmail.com" });
  if (!maya) throw new Error("maya@gmail.com was not found; nothing was changed.");
  // Remove the earlier UI-only snapshot for Maya before creating canonical rows.
  await mongoose.connection.collection("growshowcases").deleteOne({ user: maya._id });
  const codes = referralCodes(maya);
  for (const person of PEOPLE) {
    const email = `${person.username}@grow-test.atseen.local`;
    let invitee = await User.findOne({ email });
    if (!invitee) invitee = new User({ email, password: "GrowTest!2026", name: person.name, username: person.username });
    invitee.name = person.name; invitee.username = person.username; invitee.avatar = avatarFor(person);
    invitee.role = person.type === "creator" ? "creator" : "fan";
    invitee.creatorApprovalStatus = person.type === "creator" ? "approved" : null;
    invitee.status = "active";
    await invitee.save();
    const attributedAt = new Date(Date.now() - person.hoursAgo * 60 * 60 * 1000);
    const expiresAt = new Date(attributedAt); expiresAt.setMonth(expiresAt.getMonth() + 12);
    await Referral.findOneAndUpdate(
      { invitee: invitee._id },
      { $set: { inviter: maya._id, code: codes[person.type], type: person.type, attributedAt, expiresAt, earningsAmount: person.earningsAmount, coins: person.coins, latestEarningAmount: person.latestEarningAmount ?? person.earningsAmount, latestEarningCoins: person.coins } },
      { upsert: true, new: true, runValidators: true }
    );
  }
  console.log(`Created ${PEOPLE.length} normal referral relationships for ${maya.email}.`);
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
