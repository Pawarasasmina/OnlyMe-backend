import { Router } from "express";
import { listContent } from "../controllers/contentController.js";

const router = Router();

router.get("/", listContent);
router.get("/creator/:creatorId", listContent);

export default router;
