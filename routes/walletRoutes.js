import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  initiateTopup,
  verifyTopup,
  getWalletDetails,
  initiateWithdraw,
  verifyWithdraw
} from "../controllers/walletController.js";

const router = express.Router();

router.get("/details", protect, getWalletDetails);
router.post("/topup/initiate", protect, initiateTopup);
router.post("/topup/verify", protect, verifyTopup);
router.post("/withdraw/initiate", protect, initiateWithdraw);
router.post("/withdraw/verify", protect, verifyWithdraw);

export default router;
