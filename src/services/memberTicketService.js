import MemberSequence from "../models/MemberSequence.js";

export async function nextMemberNumber() {
  // Atomic allocation: numbers are never derived from a mutable user count.
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
