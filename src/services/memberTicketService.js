import mongoose from "mongoose";
import MemberSequence from "../models/MemberSequence.js";

export async function nextMemberNumber() {
  // Keep the sequence ahead of legacy/imported users before atomically
  // reserving the next number. This also repairs a stale sequence safely.
  const highest = await mongoose.connection.collection("users").findOne(
    { memberNumber: { $type: "number" } },
    { projection: { memberNumber: 1 }, sort: { memberNumber: -1 } }
  );
  const syncUpdate = { $max: { value: Number(highest?.memberNumber || 0) } };
  try {
    await MemberSequence.updateOne({ _id: "members" }, syncUpdate, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    await MemberSequence.updateOne({ _id: "members" }, syncUpdate);
  }

  let sequence;
  try {
    sequence = await MemberSequence.findOneAndUpdate(
      { _id: "members" }, { $inc: { value: 1 } }, { upsert: true, new: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    // Another registration may have created the counter on its first use.
    sequence = await MemberSequence.findOneAndUpdate(
      { _id: "members" }, { $inc: { value: 1 } }, { new: true }
    );
  }
  return sequence.value;
}
