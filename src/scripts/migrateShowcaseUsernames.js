import mongoose from "mongoose";
import { env } from "../config/env.js";
import User from "../models/User.js";
import UsernameReservation from "../models/UsernameReservation.js";

const assignments = [
  ["maya@gmail.com", "maya.senanayake"], ["noah@gmail.com", "noah.williams"],
  ["sofia@gmail.com", "sofia.marin"], ["oliver@gmail.com", "oliver.brooks"],
  ["aisha@gmail.com", "aisha.rahman"], ["liam@gmail.com", "liam.carter"],
  ["priya@gmail.com", "priya.nair"], ["lucas@gmail.com", "lucas.reed"],
  ["amara@gmail.com", "amara.okafor"], ["kenji@gmail.com", "kenji.sato"],
  ["elena@gmail.com", "elena.petrova"], ["marcus@gmail.com", "marcus.lee"],
  ["zara@gmail.com", "zara.bennett"], ["daniel@gmail.com", "daniel.kim"],
  ["nia@gmail.com", "nia.campbell"], ["rafael@gmail.com", "rafael.costa"],
  ["chloe@gmail.com", "chloe.martin"], ["arjun@gmail.com", "arjun.mehta"],
  ["hana@gmail.com", "hana.mori"], ["victor@gmail.com", "victor.mensah"],
];

const apply = process.argv.includes("--apply");
const now = new Date();
const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

try {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000 });
  const emails = assignments.map(([email]) => email);
  const requestedUsernames = assignments.map(([, username]) => username);
  const users = await User.find({ email: { $in: emails } }).select("email name username usernameChangedAt");
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  const missing = emails.filter((email) => !byEmail.has(email));
  const conflicts = await User.find({ username: { $in: requestedUsernames }, email: { $nin: emails } }).select("email username").lean();
  const reserved = await UsernameReservation.find({ username: { $in: requestedUsernames }, expiresAt: { $gt: now } }).select("username user expiresAt").lean();
  if (missing.length || conflicts.length || reserved.length) {
    console.error(JSON.stringify({ missing, conflicts, reserved }, null, 2));
    process.exitCode = 1;
  } else {
    const preview = assignments.map(([email, nextUsername]) => {
      const user = byEmail.get(email);
      return { email, name: user.name, previousUsername: user.username, nextUsername, changedAt: now, oldHandleReservedUntil: user.username === nextUsername ? null : expiresAt };
    });
    console.log(JSON.stringify({ database: mongoose.connection.name, apply, users: preview }, null, 2));
    if (apply) {
      for (const [email, nextUsername] of assignments) {
        const user = byEmail.get(email);
        const previousUsername = user.username;
        if (previousUsername !== nextUsername) {
          await UsernameReservation.findOneAndUpdate(
            { username: previousUsername },
            { $set: { user: user._id, expiresAt } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
        }
        user.username = nextUsername;
        user.usernameChangedAt = now;
        try {
          await user.save();
        } catch (error) {
          if (previousUsername !== nextUsername) await UsernameReservation.deleteOne({ username: previousUsername, user: user._id, expiresAt });
          throw error;
        }
      }
      console.log(`Updated ${assignments.length} showcase usernames; cooldown expires ${expiresAt.toISOString()}.`);
    }
  }
} finally {
  await mongoose.disconnect();
}
