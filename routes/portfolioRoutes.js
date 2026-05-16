import express from "express";
import { getPortfolio, buyFund, sellFund, getTransactions, reviewPortfolio } from "../controllers/portfolioController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.route("/").get(protect, getPortfolio);
router.route("/buy").post(protect, buyFund);
router.route("/sell").post(protect, sellFund);
router.route("/transactions").get(protect, getTransactions);
router.route("/review").get(protect, reviewPortfolio);

export default router;
