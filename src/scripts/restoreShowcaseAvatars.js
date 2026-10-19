import mongoose from "mongoose";

import { connectDb } from "../config/db.js";
import User from "../models/User.js";

const apply = process.argv.includes("--apply");

// These uploads were made consecutively while editing the showcase users in
// the same order as the seed list. The guard below prevents overwriting any
// avatar that has been edited again since the showcase seed ran.
const replacements = [
  ["mayamind", "1494790108377-be9c29b29330", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791780298/onlyme/profiles/ud5tsilpnw9ucmtm50di.jpg"],
  ["noahliving", "1500648767791-00dcc994a43e", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791780556/onlyme/profiles/xsjfnm6p2k8x3am2n6us.jpg"],
  ["sofiamarin", "1534528741775-53994a69daeb", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791780653/onlyme/profiles/rgydwxwpws8qpddf7kuw.jpg"],
  ["oliverwealth", "1507003211169-0a1dd7228f2d", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791780821/onlyme/profiles/hfhbwdhkirhnm9uctymj.jpg"],
  ["aishabuildsai", "1531123897727-8f129e1688ce", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791780952/onlyme/profiles/be1i6iwsqrh9goih4gnc.jpg"],
  ["liamtrains", "1506794778202-cad84cf45f1d", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791781108/onlyme/profiles/okoef1rkwd4cm1fkmvdb.jpg"],
  ["priyawellness", "1531746020798-e6953c6e8e04", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791781211/onlyme/profiles/q2iug7p5gvbyt9dewgcv.jpg"],
  ["lucasframes", "1501196354995-cbb51c65aaea", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791781306/onlyme/profiles/jwssdvhjgk5shrcthxou.jpg"],
  ["amarafinance", "1531123897727-8f129e1688ce", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791781472/onlyme/profiles/mi4iwd0qxf0ep4ekgqeg.jpg"],
  ["kenjimoves", "1527980965255-d3b416303d12", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791781559/onlyme/profiles/djrtogezmgajd91aeyuo.jpg"],
  ["elenainsight", "1494790108377-be9c29b29330", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791781926/onlyme/profiles/vii5qfgk4o6nfsruk8uk.jpg"],
  ["marcusdaily", "1500648767791-00dcc994a43e", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791782096/onlyme/profiles/fek0nrszqk9fspmfib6e.jpg"],
  ["zarainframe", "1534528741775-53994a69daeb", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791782177/onlyme/profiles/hlyfcu115xbzwnyyzzfe.jpg"],
  ["danielmoney", "1507003211169-0a1dd7228f2d", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791782267/onlyme/profiles/v41xmgeu8jsmc4rkzlwb.jpg"],
  ["niacodesai", "1531123897727-8f129e1688ce", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791782335/onlyme/profiles/yy4m8m3mzyqnz6l2qyki.jpg"],
  ["rafaelstrength", "1506794778202-cad84cf45f1d", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791782393/onlyme/profiles/l3ucxzh6rfjhoem3oupa.jpg"],
  ["chloemindful", "1531746020798-e6953c6e8e04", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791782586/onlyme/profiles/cppn2ghr44lgvf54tor9.jpg"],
  ["arjunmodernlife", "1501196354995-cbb51c65aaea", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791782725/onlyme/profiles/kpdmlwseg78uvrffhe0y.jpg"],
  ["hanastyled", "1531123897727-8f129e1688ce", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791782840/onlyme/profiles/cogh6wwstuig0s7gn80t.jpg"],
  ["victorbuilds", "1527980965255-d3b416303d12", "https://res.cloudinary.com/dlcrlssz4/image/upload/v1791782913/onlyme/profiles/cobvqx09mhqsh7aaqe3k.jpg"],
];

async function main() {
  await connectDb();
  const rows = [];
  for (const [username, seededPhotoId, restoredAvatar] of replacements) {
    const user = await User.findOne({ username }).select("username avatar").lean();
    const eligible = Boolean(user?.avatar?.includes(`photo-${seededPhotoId}`));
    let restored = false;
    if (apply && eligible) {
      const result = await User.updateOne(
        { _id: user._id, avatar: user.avatar },
        { $set: { avatar: restoredAvatar } },
      );
      restored = result.modifiedCount === 1;
    }
    rows.push({ username, eligible, restored, reason: !user ? "user-not-found" : eligible ? (apply ? "restored" : "ready") : "avatar-changed-after-seed" });
  }
  console.table(rows);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", eligible: rows.filter((row) => row.eligible).length, restored: rows.filter((row) => row.restored).length, skipped: rows.filter((row) => !row.eligible).length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
