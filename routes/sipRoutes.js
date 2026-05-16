import express from "express";
import { getSIPs, createSIP, updateSIP, executeSIP } from "../controllers/sipController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.route("/").get(protect, getSIPs).post(protect, createSIP);
router.route("/:id").put(protect, updateSIP);
router.route("/:id/execute").post(protect, executeSIP);

export default router;
