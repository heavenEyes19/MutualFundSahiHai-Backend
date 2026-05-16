import express from "express";
import { initiateBuy, verifyBuy } from "../controllers/paymentController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/create-order", protect, initiateBuy);
router.post("/verify-payment", protect, verifyBuy);

export default router;
