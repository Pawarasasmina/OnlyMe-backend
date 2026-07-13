import { Router } from "express";
import authRoutes from "./authRoutes.js";
import userRoutes from "./userRoutes.js";
import creatorRoutes from "./creatorRoutes.js";
import contentRoutes from "./contentRoutes.js";
import adminRoutes from "./adminRoutes.js";
import profileRoutes from "./profileRoutes.js";
import publicProfileRoutes from "./publicProfileRoutes.js";
import { sendResponse } from "../utils/response.js";

const router = Router();

router.get("/health", (_req, res) => sendResponse(res, 200, "OnlyMe API is running"));
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/profile", profileRoutes);
router.use("/", publicProfileRoutes);
router.use("/creator", creatorRoutes);
router.use("/content", contentRoutes);
router.use("/admin", adminRoutes);

export default router;
