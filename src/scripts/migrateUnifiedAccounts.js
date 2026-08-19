import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import User from "../models/User.js";

const apply = process.argv.includes("--apply");

async function run() {
  await connectDb();
  const legacyCreators = await User.find({ role: "creator" }).lean();
  const report = { mode: apply ? "apply" : "dry-run", legacyCreators: legacyCreators.length, profilesCreated: 0, rolesUpdated: 0 };

  for (const user of legacyCreators) {
    const creatorProfile = await CreatorProfile.findOne({ user: user._id }).lean();
    if (!await FanProfile.exists({ user: user._id })) {
      report.profilesCreated += 1;
      if (apply) await FanProfile.create({
        user: user._id,
        coverPhoto: creatorProfile?.coverPhoto || "",
        bio: creatorProfile?.bio || "",
        city: creatorProfile?.city || "",
        country: creatorProfile?.country || "",
        phoneNumber: creatorProfile?.phoneNumber || "",
        whatsapp: creatorProfile?.whatsapp || "",
        orbitStatus: creatorProfile?.orbitStatus || "",
        profileVisibility: creatorProfile?.profileVisibility || "public",
        preferredLanguage: creatorProfile?.preferredLanguage || "en",
        timezone: creatorProfile?.timezone || "UTC",
      });
    }
    report.rolesUpdated += 1;
    if (apply) await User.updateOne({ _id: user._id, role: "creator" }, { $set: { role: "fan" } });
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
