// Display every recorded viewer, including TEST accounts. Keep the historical
// non-test counter intact for analytics and older imported records.
export function wallViewCount(post = {}) {
  const regular = new Set();
  const test = new Set();
  const author = String(post.author?._id || post.author?.id || post.author || "");
  for (const view of post.views || []) {
    const id = String(view.user?._id || view.user?.id || view.user || "");
    if (!id || id === author) continue;
    (view.actorAccountType === "TEST" ? test : regular).add(id);
  }
  for (const id of regular) test.delete(id);
  return Math.max(0, Number(post.viewCount) || 0, regular.size) + test.size;
}
