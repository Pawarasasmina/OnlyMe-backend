import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { CREATOR_PAID_TOPICS, LEGACY_PAID_TOPICS, PAID_SEED_SOURCE, creatorPaidTitle, paidSeedTitleRepair } from "./creatorPaidSeedTitles.js";

const apply = process.argv.includes("--apply");

async function main() {
  if (env.nodeEnv === "production") throw new Error("Refusing to repair demo seed content in production.");
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const users = await db.collection("users").find({ email: { $in: Object.keys(CREATOR_PAID_TOPICS) } }, { projection: { email: 1, name: 1 } }).toArray();
  const owners = new Map(users.map(user => [String(user._id), user]));
  const publications = await db.collection("publications").find({ creator: { $in: users.map(user => user._id) }, $or: [{ seedSource: PAID_SEED_SOURCE, kind: "SEEN" }, { seedSource: "client-showcase-v1", kind: "EXPERIENCE", title: { $regex: " Foundations$" } }] }).toArray();
  if (apply) {
    const directory = path.resolve("../.tmp");
    fs.mkdirSync(directory, { recursive: true });
    const backup = path.join(directory, `creator-seed-titles-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(publications, null, 2), { flag: "wx" });
    console.log(`Seed publication backup: ${backup}`);
  }
  const report = [];
  for (const publication of publications) {
    const user = owners.get(String(publication.creator));
    const foundation = publication.seedSource === "client-showcase-v1";
    const index = Number(publication.seedKey?.match(/^paid-seen-(\d+)$/)?.[1]) - 1;
    if (!foundation && (!Number.isInteger(index) || index < 0)) continue;
    const oldTitle = foundation ? publication.title : LEGACY_PAID_TOPICS[publication.category]?.[index];
    if (!oldTitle) continue;
    const firstName = user.name.split(" ")[0];
    const title = foundation ? `${firstName}'s ${oldTitle}` : creatorPaidTitle(user.email, index);
    const repair = paidSeedTitleRepair(publication, { oldTitle, title, firstName, foundation });
    if (!repair) continue;
    let updated = false;
    if (apply) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const result = await db.collection("publications").updateOne({ _id: publication._id, creator: user._id, seedSource: publication.seedSource, title: oldTitle, updatedAt: publication.updatedAt }, { $set: repair.fields }, { session });
          updated = result.modifiedCount === 1;
          if (!updated) return;
          await db.collection("chapters").updateMany({ publication: publication._id, "blocks.text": repair.oldPreview }, { $set: { "blocks.$[preview].text": repair.preview } }, { arrayFilters: [{ "preview.text": repair.oldPreview }], session });
        });
      } finally {
        await session.endSession();
      }
    }
    report.push({ creator: user.name, publicationId: String(publication._id), previousTitle: oldTitle, title, updated });
  }
  console.table(report);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", eligible: report.length, updated: report.filter(row => row.updated).length }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
