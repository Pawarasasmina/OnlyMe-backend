import { connectDb } from "../config/db.js";
import Conversation from "../models/Conversation.js";
import FanProfile from "../models/FanProfile.js";
import Message from "../models/Message.js";
import User from "../models/User.js";

const targetUsername = process.argv[2] || "creator2";
const samples = [
  ["Maya Chen", "request_maya", "Your latest Seen really stayed with me. Can I ask you something?"],
  ["Daniel Brooks", "request_daniel", "I found your profile through Discover and wanted to say hello."],
  ["Nora Silva", "request_nora", "Would you share how you started creating your Seens?"],
];

async function upsertFan([name, username]) {
  const email = `${username}@test.onlyme.local`;
  let user = await User.findOne({ $or: [{ username }, { email }] }).select("+password");
  if (!user) user = await User.create({ email, name, onboarding: { status: "completed", currentStep: "completed", completedAt: new Date() }, password: "OnlyMeTest123!", role: "fan", status: "active", username });
  await FanProfile.findOneAndUpdate({ user: user._id }, { $setOnInsert: { user: user._id } }, { upsert: true });
  return user;
}

async function run() {
  await connectDb();
  const recipient = await User.findOne({ username: targetUsername, status: "active" });
  if (!recipient) throw new Error(`Active target account @${targetUsername} was not found`);

  for (const sample of samples) {
    const sender = await upsertFan(sample);
    const participantKey = [String(sender._id), String(recipient._id)].sort().join(":");
    await Conversation.findOneAndUpdate(
      { participantKey },
      { $set: { fan: sender._id, creator: recipient._id, participants: [sender._id, recipient._id], requestRecipient: recipient._id, requestStartedAt: new Date(), status: "REQUEST" } },
      { upsert: true },
    );
    await Message.findOneAndUpdate(
      { sender: sender._id, clientMessageId: `seed-request-${sender.username}-${recipient._id}` },
      { $setOnInsert: { body: sample[2], clientMessageId: `seed-request-${sender.username}-${recipient._id}`, mediaType: "text", messageChannel: "STANDARD", recipient: recipient._id, sender: sender._id } },
      { upsert: true },
    );
  }
  console.log(`Seeded ${samples.length} message requests for @${targetUsername}`);
  process.exit(0);
}

run().catch((error) => { console.error(error.message); process.exit(1); });
