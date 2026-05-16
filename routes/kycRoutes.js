import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  submitKYC,
  getKYCStatus,
  getAllKYC,
  verifyKYC,
} from "../controllers/kycController.js";

const router = express.Router();

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Images only! (jpeg, jpg, png)"));
    }
  },
});

// Routes
router.post(
  "/submit",
  protect,
  upload.fields([
    { name: "panCardPhoto", maxCount: 1 },
    { name: "submissionPhoto", maxCount: 1 },
  ]),
  submitKYC
);

router.get("/status", protect, getKYCStatus);

// Admin routes
router.get("/all", protect, admin, getAllKYC);
router.put("/verify/:id", protect, admin, verifyKYC);

export default router;
