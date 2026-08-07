import { Router } from "express";
import {
  createDraftPost,
  createFeedPost,
  createPostComment,
  deleteFeedPost,
  blockPostAuthor,
  getFeedPost,
  hideFeedPost,
  listFeedPosts,
  listMyPosts,
  markFeedPostViewed,
  reportFeedPost,
  togglePostSave,
  togglePostShare,
  updatePostReaction,
  updateFeedPost,
} from "../controllers/postController.js";
import { protect } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/roleMiddleware.js";
import { uploadFeedPostImages } from "../middleware/uploadMiddleware.js";

const router = Router();
const creatorOnly = [protect, authorize("creator")];

router.get("/", protect, listFeedPosts);
router.get("/mine", ...creatorOnly, listMyPosts);
router.get("/drafts", ...creatorOnly, (req, res, next) => {
  req.query.status = "draft";
  return listMyPosts(req, res, next);
});
router.post("/", ...creatorOnly, uploadFeedPostImages.array("media", 4), createFeedPost);
router.post("/drafts", ...creatorOnly, uploadFeedPostImages.array("media", 4), createDraftPost);
router.get("/:id", protect, getFeedPost);
router.post("/:id/views", protect, markFeedPostViewed);
router.put("/:id/reaction", protect, updatePostReaction);
router.put("/:id/save", protect, togglePostSave);
router.put("/:id/share", protect, togglePostShare);
router.post("/:id/hide", protect, hideFeedPost);
router.post("/:id/report", protect, reportFeedPost);
router.put("/:id/block-author", protect, blockPostAuthor);
router.post("/:id/comments", protect, createPostComment);
router.put("/:id", ...creatorOnly, updateFeedPost);
router.delete("/:id", ...creatorOnly, deleteFeedPost);

export default router;
