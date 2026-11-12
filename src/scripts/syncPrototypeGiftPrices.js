import "dotenv/config";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import Gift from "../models/Gift.js";

const EVERY = [5,5,5,6,6,7,7,8,8,9,9,10,10,10,12,12,14,15,15,16,18,18,20,20,20];
const WARM = [25,25,25,28,30,30,30,32,35,35,38,40,40,42,45,45,48,50,50,50,55,55,58,60,60,65,65,70,70,75,75,80,85,90,90];
const BIG = [100,110,120,130,150,160,180,200,220,250,280];
const LEGENDARY = [300,320,350,380,400,420,450,480,500,520,550,600,650,700,750,800,850,900,950];
const VAULT = [1000,1200,1500,1800,2000,2500,2800,3000,3500,4000,5000];
const DEFAULT_PROTOTYPE = "C:/Users/Pawara/.codex/attachments/808b4d41-59c4-4d87-8a45-9a0386ed8ba3/Pasted text.txt";
const apply = process.argv.includes("--apply");
const prototypeArg = process.argv.find((value) => value.startsWith("--prototype="));
const prototypePath = prototypeArg ? prototypeArg.slice("--prototype=".length) : DEFAULT_PROTOTYPE;
const normalize = (value) => String(value || "").trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim();
const source = await readFile(prototypePath, "utf8");
const extractArray = (name) => { const marker = new RegExp(`const\\s+${name}\\s*=\\s*\\[`).exec(source); if (!marker) throw new Error(`Prototype block not found: ${name}`); const from = marker.index + marker[0].length - 1; let depth = 0, quote = "", escaped = false; for (let index = from; index < source.length; index += 1) { const character = source[index]; if (quote) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === quote) quote = ""; continue; } if (["'", '"', "`"].includes(character)) { quote = character; continue; } if (character === "[") depth += 1; if (character === "]" && --depth === 0) return source.slice(from, index + 1); } throw new Error(`Prototype array is incomplete: ${name}`); };
const gifts = vm.runInNewContext(`(${extractArray("GIFTS")})`, {}, { timeout: 1000 });
const sections = vm.runInNewContext(`(${extractArray("GSEC")})`, {}, { timeout: 1000 });
const sectionFor = (key) => sections.find((section) => section.k.includes(key))?.t || "";
const fit = (list, ladder) => [...list].sort((left, right) => left.s - right.s).forEach((gift, index) => { gift.s = ladder[Math.round(index * (ladder.length - 1) / Math.max(1, list.length - 1))]; });
fit(gifts.filter((gift) => sectionFor(gift.k) === "The Vault"), VAULT);
fit(gifts.filter((gift) => sectionFor(gift.k) === "Legendary"), LEGENDARY);
fit(gifts.filter((gift) => !["The Vault", "Legendary"].includes(sectionFor(gift.k))), [...EVERY, ...WARM, ...BIG]);
const priceByName = new Map(gifts.map((gift) => [normalize(gift.n), gift.s]));
priceByName.set(normalize("Cristal City"), priceByName.get(normalize("Crystal City")));

if (!env.mongoUri) throw new Error("MONGODB_URI is required");
console.log(`Connecting to the configured gift catalog database (${apply ? "apply" : "dry run"})...`);
await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 15000, family: 4 });
try {
  const catalog = await Gift.find().sort({ sortOrder: 1, createdAt: 1 });
  const matched = catalog.filter((gift) => priceByName.has(normalize(gift.name)));
  const unmatched = catalog.filter((gift) => !priceByName.has(normalize(gift.name)));
  const changes = matched.map((gift) => ({ gift, stars: priceByName.get(normalize(gift.name)) })).filter(({ gift, stars }) => gift.stars !== stars);
  console.log(`Prototype=${gifts.length}; catalog=${catalog.length}; matched=${matched.length}; unmatched=${unmatched.length}; changes=${changes.length}; mode=${apply ? "APPLY" : "DRY RUN"}`);
  unmatched.forEach((gift) => console.log(`UNMATCHED: ${gift.name} (${gift.stars})`));
  changes.forEach(({ gift, stars }) => console.log(`${gift.name}: ${gift.stars} -> ${stars}`));
  if (apply && changes.length) await Gift.bulkWrite(changes.map(({ gift, stars }) => ({ updateOne: { filter: { _id: gift._id }, update: { $set: { stars } } } })));
} finally {
  await mongoose.disconnect();
}
