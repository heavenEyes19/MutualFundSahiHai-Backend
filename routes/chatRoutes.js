import express from "express";
import { getChatHistory, getChatInvestors, deleteChatHistory } from "../controllers/chatController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/history", protect, getChatHistory);
router.get("/history/:investorId", protect, getChatHistory);
router.delete("/history/:investorId", protect, deleteChatHistory);
router.get("/investors", protect, getChatInvestors);

export default router;
