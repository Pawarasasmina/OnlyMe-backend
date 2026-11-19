import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import Gift from "../models/Gift.js";
import ChatGift from "../models/ChatGift.js";
import Message from "../models/Message.js";

const captions = {
  "Caught Feelings": "This got me in my feelings",
  "I Love You": "I love this",
  "Main Character": "Main character energy",
  "Glow Up": "You’re glowing",
  "Retail Therapy": "Treat yourself",
  "Fit Check": "Fit goes hard",
  "Beam Me Up": "Take me with you",
  "Pop Off": "You absolutely killed this",
  "To The Moon": "Keep going — all the way",
  "Proud of You": "So proud of you",
  "The Treasure": "Worth more than gold",
  "You Got This": "All the way to the top",
  "Night Rider": "Built different",
  "Full Send": "No brakes",
  "Royalty": "Absolute royalty",
  "The Crown": "You wear it best",
  "Take My Heart": "It’s yours now",
  "Soft Spot": "You’re my soft spot",
  "Butterflies": "You give me butterflies",
  "Tulips": "Just because",
  "Sent With Love": "Flew straight to you",
  "The Question": "Say yes",
  "Just For You": "Open me",
  "My Star": "You’re the star here",
  "Boba Date": "First sip is yours",
  "Sweet Ride": "Sweetest thing today",
  "Little World": "Our own little world",
  "Carousel": "Round and round with you",
  "Little Dancer": "You make it look easy",
  "Balloon Friend": "Never lets you down",
  "Make a Wish": "Close your eyes and blow",
  "The Pearl": "Found something rare",
  "Sweet Dreams": "Rest. You earned it",
  "Moon Chair": "Saved you a seat",
  "Tiara": "Obviously yours",
  "Glide On": "Life looks good on you",
  "Call Me": "I miss your voice",
  "Lost in Music": "This song is us",
  "In Sync": "Same wave, always",
  "Sweet Sip": "This one is on me",
  "Rewind": "Replaying our best moments",
  "B-Side": "For your rare sides",
  "Unplugged": "Play it like you feel it",
  "Just Because": "No reason. Just you",
  "Keep Going": "One more mile",
  "Aura": "You are magic",
  "No Bad Days": "Future looks bright",
  "The Moment": "Caught you being great",
  "Voltage": "Pure energy",
  "Eyes Up": "Watching you win",
  "Dream Plan Do": "In that order",
  "Spark": "Light it up",
  "Inner Fire": "Never let it die",
  "On Time": "Your time is now",
  "No Days Off": "Strength suits you",
  "Grandmaster": "Three moves ahead. Always",
  "True North": "Keep moving forward",
  "Player One": "You set the difficulty",
  "Next Chapter": "Pack light. Go far",
  "Explore More": "The world is waiting",
  "Far Sight": "You saw it first",
  "Stargazer": "Aim higher than the sky",
  "Our Time": "Worth every second",
  "Stay Focused": "Eyes on the prize",
  "Focus & Drive": "Smells like success",
  "Full Throttle": "Speed becomes you",
  "Discipline": "Sharp mind. Calm heart",
  "Top Shelf": "To the ones who earned it",
  "All In": "Bet on yourself",
  "Deep Work": "Build your empire",
  "The Moon": "I’d bring it down for you",
  "Your World": "The world orbits you",
  "The Deal": "Signed. Sealed. Yours",
  "Heart of Chrome": "It beats for real ones",
  "First Class": "You belong up there",
  "Offshore": "Salt and speed",
  "Off Road": "No road? No problem",
  "Time Creates Legends": "And you’re proof",
  "Eternity": "Time belongs to you now",
  "Golden Hour": "To nights that never end",
  "Nocturne": "Music written only for you",
  "Crystal City": "Your city, frozen in crystal",
  "The Universe": "It all revolves around you",
  "Iced Out": "Frozen at the top",
  "Private Island": "A world of your own",
  "Wheels Up": "Departure whenever you want",
  "Flagship": "Arrive like an empire",
  "Beyond": "Not from this world",
  "The Imperial": "Above every crown",
  "Forever": "Always with you",
  "Take Your Time": "No rush — I will wait",
  "Soft Sound": "For quiet evenings",
  "Text Me Back": "Waiting for your reply",
  "The Win": "You earned this",
  "Pole Position": "Train like a champion",
  "Liftoff": "Nothing can stop you",
  "Heirloom": "Time worth keeping",
  "Midnight Moto": "No speed limits tonight",
  "The Peak": "Above the clouds now",
  "Showstopper": "All eyes on you",
  "Dark Water": "Silent power"
};

async function run() {
  await connectDb();
  const gifts = await Gift.find({}).select("name caption");
  const operations = gifts.flatMap((gift) => {
    const caption = captions[gift.name];
    return caption && caption !== gift.caption ? [{ updateOne: { filter: { _id: gift._id }, update: { $set: { caption } } } }] : [];
  });
  if (operations.length) await Gift.bulkWrite(operations);
  const refreshed = await Gift.find({ caption: { $ne: "" } }).select("name caption").lean();
  const byName = new Map(refreshed.map((gift) => [gift.name, gift.caption]));
  const chatGiftUpdates = [...byName].map(([name, caption]) => ({ updateMany: { filter: { giftName: name }, update: { $set: { giftCaption: caption } } } }));
  const messageUpdates = [...byName].map(([name, caption]) => ({ updateMany: { filter: { mediaType: "gift", "gift.name": name }, update: { $set: { "gift.caption": caption } } } }));
  if (chatGiftUpdates.length) await ChatGift.bulkWrite(chatGiftUpdates);
  if (messageUpdates.length) await Message.bulkWrite(messageUpdates);
  const unmatched = Object.keys(captions).filter((name) => !gifts.some((gift) => gift.name === name));
  console.log(JSON.stringify({ gifts: gifts.length, updatedCatalog: operations.length, syncedGiftSnapshots: refreshed.length, prototypeCaptions: Object.keys(captions).length, unmatched }, null, 2));
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());

