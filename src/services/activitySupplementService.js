import FeedPost from "../models/FeedPost.js";
import mongoose from "mongoose";
import Repost from "../models/Repost.js";
import ProfileMedia from "../models/ProfileMedia.js";
import SavedItem from "../models/SavedItem.js";
import SeenEngagement from "../models/SeenEngagement.js";
import WallEngagement from "../models/WallEngagement.js";
import WallShareEngagement from "../models/WallShareEngagement.js";

const id = value => String(value?._id || value || "");
const actor = user => ({ id: id(user), displayName: user.name || user.username || "Someone", username: user.username, avatarUrl: user.avatar || "" });
const base = item => ({ direction: "received", canAcknowledge: false, ...item, filterKeys: [item.filter], relatedCreator: item.actor || null, route: item.actionPath });

// Resolve current content rather than keeping a stale copy after deletion.
export async function supplementalActivity(userId, limit = 100) {
  const [posts, seen, wall, shares, photos] = await Promise.all([
    FeedPost.find({ status: "published", deletedAt: null, "comments.user": userId }).sort({ updatedAt: -1 }).limit(limit).populate("comments.user", "name username avatar").lean(),
    SeenEngagement.find({ user: userId, type: "COMMENT" }).sort({ createdAt: -1 }).limit(limit).populate({ path: "publication", match: { status: "PUBLISHED" }, select: "creator visibility title kind publishedSnapshot" }).lean(),
    WallEngagement.find({ user: userId, type: "COMMENT" }).sort({ createdAt: -1 }).limit(limit).populate({ path: "post", match: { status: "PUBLISHED" }, select: "creator text" }).lean(),
    WallShareEngagement.find({ user: userId, type: "COMMENT" }).sort({ createdAt: -1 }).limit(limit).populate({ path: "share", populate: { path: "post", match: { status: "PUBLISHED" } } }).lean(),
    ProfileMedia.find({ user: userId, type: "image", $or: [{ "reactions.0": { $exists: true } }, { "likedBy.0": { $exists: true } }] }).sort({ updatedAt: -1 }).limit(limit).populate("reactions.user likedBy", "name username avatar status").lean(),
  ]);
  const targets = new Map();
  const output = [];
  for (const post of posts) {
    if (post.visibility === "private" && id(post.author) !== id(userId)) continue;
    for (const comment of post.comments || []) {
      if (comment.deletedAt || id(comment.user) !== id(userId)) continue;
      targets.set(id(comment._id), { model: "FeedPostComment", comment: comment.text, note: post.text, target: { type: "WALL_POST", id: id(post._id), preview: post.text }, route: `/posts/${post._id}?comment=${comment._id}` });
      if (id(post.author) === id(userId)) continue; // Already supplied by normal note activity.
      for (const reply of post.comments.filter(row => !row.deletedAt && id(row.parentCommentId) === id(comment._id) && id(row.user) !== id(userId) && row.user?.username)) {
        output.push(base({ id: `note-reply-${reply._id}`, type: "note_reply", filter: "comments", title: `${reply.user.name || reply.user.username} replied to your comment`, preview: reply.text, createdAt: reply.createdAt, actor: actor(reply.user), target: { type: "WALL_POST", id: id(post._id), preview: post.text }, actionPath: `/posts/${post._id}?comment=${reply._id}` }));
      }
    }
  }
  for (const comment of seen) {
    const publication = comment.publication;
    if (!publication || publication.visibility && publication.visibility !== "PUBLIC" && id(publication.creator) !== id(userId)) continue;
    targets.set(id(comment._id), { model: "SeenEngagement", comment: comment.text, target: { type: publication.kind, id: id(publication._id), preview: publication.title, ...coverPreview(publication) }, route: `${publication.kind?.includes("WORLD") ? "/world" : "/seen"}/${publication._id}?comment=${comment._id}` });
  }
  for (const [rows, model] of [[wall, "WallEngagement"], [shares, "WallShareEngagement"]]) for (const comment of rows) {
    const post = comment.post || comment.share?.post;
    if (post) targets.set(id(comment._id), { model, comment: comment.text, target: { type: "WALL_POST", id: id(post._id), preview: post.text }, route: `/posts/${post._id}?comment=${comment._id}` });
  }
  const saves = targets.size ? await SavedItem.find({ user: { $ne: userId }, targetType: "comment", targetId: { $in: [...targets.keys()] } }).sort({ createdAt: -1 }).lean() : [];
  const groups = new Map();
  for (const save of saves) {
    const target = targets.get(id(save.targetId));
    if (!target || target.model !== save.targetModel) continue;
    const group = groups.get(id(save.targetId)) || { users: new Set(), latest: save.createdAt, target };
    group.users.add(id(save.user)); groups.set(id(save.targetId), group);
  }
  for (const [commentId, group] of groups) output.push(base({ id: `comment-save-group-${commentId}`, type: "comment_save_group", filter: "saves", title: `${group.users.size} ${group.users.size === 1 ? "person" : "people"} saved your comment`, preview: group.target.comment, target: group.target.target, actionPath: group.target.route, createdAt: group.latest, aggregate: { count: group.users.size }, metadata: { savedComment: true, commentId } }));
  for (const photo of photos) {
    const groups = new Map();
    const reactions = photo.reactions || [];
    const legacy = (photo.likedBy || []).filter(user => !reactions.some(row => id(row.user) === id(user))).map(user => ({ user, emoji: "❤️", createdAt: photo.updatedAt || photo.createdAt }));
    for (const reaction of [...reactions, ...legacy]) {
      if (!reaction.user?.username || reaction.user.status !== "active" || id(reaction.user) === id(userId)) continue;
      const group = groups.get(reaction.emoji) || [];
      if (!group.some(row => id(row.user) === id(reaction.user))) group.push(reaction);
      groups.set(reaction.emoji, group);
    }
    for (const [emoji, rows] of groups) {
      rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const names = rows.slice(0, 2).map(row => row.user.name || row.user.username).join(", ");
      output.push(base({ id: `photo-reaction-${photo._id}-${emoji}`, type: "photo_reaction_group", filter: "support", title: `${names}${rows.length > 2 ? ` and ${rows.length - 2} others` : ""} reacted ${emoji} to your photo`, createdAt: rows[0].createdAt, actor: actor(rows[0].user), target: { type: "PHOTO", id: id(photo._id), imageUrl: photo.thumbnailUrl || photo.url }, actionPath: `/profile?photo=${photo._id}`, metadata: { reaction: emoji }, aggregate: { count: rows.length } }));
    }
  }
  const reposts = await Repost.find({ $or: [{ originalAuthor: userId }, { user: userId }] }).sort({ createdAt: -1 }).limit(limit).populate("user originalAuthor", "name username avatar status").lean();
  for (const repost of reposts) {
    const received = id(repost.originalAuthor) === id(userId);
    const person = received ? repost.user : repost.originalAuthor;
    if (!person?.username || person.status !== "active") continue;
    const content = await mongoose.model(repost.targetModel).findById(repost.targetId).lean();
    if (!content || content.deletedAt || content.status && !["PUBLISHED", "published"].includes(content.status)) continue;
    let target, path;
    if (repost.kind === "seen") {
      if ((content.publishedSnapshot?.metadata?.visibility || content.visibility) === "PRIVATE") continue;
      target = { type: content.kind, id: id(content), preview: content.publishedSnapshot?.metadata?.title || content.title, ...coverPreview(content) };
      path = `${content.kind?.includes("WORLD") ? "/world" : "/seen"}/${content._id}`;
    } else if (repost.kind === "note") {
      if (content.visibility === "private" && !received) continue;
      target = { type: "WALL_POST", id: id(content), preview: content.text };
      path = `/posts/${content._id}`;
    } else if (repost.kind === "photo") {
      target = { type: "PHOTO", id: id(content), imageUrl: content.thumbnailUrl || content.url };
      path = `/profile/${encodeURIComponent(repost.originalAuthor.username)}?photo=${content._id}`;
    } else if (repost.kind === "cm" && received && targets.has(id(content))) {
      const commentTarget = targets.get(id(content));
      target = commentTarget.target;
      path = commentTarget.route;
    } else continue;
    const label = repost.kind === "seen" ? "Seen" : repost.kind === "cm" ? "comment" : repost.kind;
    output.push({ ...base({ id: `repost-${repost._id}`, type: "content_repost", filter: "support", title: received ? `${person.name || person.username} reposted your ${label}` : `You reposted ${person.name || person.username}'s ${label}`, preview: target.preview, actor: actor(person), target, actionPath: path, createdAt: repost.createdAt }), direction: received ? "received" : "sent" });
  }
  return output;
}

export function coverPreview(publication) {
  const cover = publication?.publishedSnapshot?.metadata?.coverMedia || publication?.coverMedia;
  const url = cover?.secureUrl || cover?.url;
  return !url ? {} : cover.resourceType === "video" || cover.mediaType === "VIDEO" ? { videoUrl: url } : { imageUrl: url };
}
