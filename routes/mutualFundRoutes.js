import express from "express";
import {
  getLatestMutualFundNav,
  getMutualFundDetails,
  listMutualFunds,
  searchMutualFunds,
  getTrendingFunds,
  getTopPerformingFunds,
  getFundCategories,
  getRecommendedFunds
} from "../controllers/mutualFundController.js";

const router = express.Router();

router.get("/trending", getTrendingFunds);
router.get("/top-performing", getTopPerformingFunds);
router.get("/categories", getFundCategories);
router.get("/recommended", getRecommendedFunds);

router.get("/", listMutualFunds);
router.get("/search", searchMutualFunds);
router.get("/:schemeCode/latest", getLatestMutualFundNav);
router.get("/:schemeCode", getMutualFundDetails);

export default router;

