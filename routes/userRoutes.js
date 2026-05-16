import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import KYC from "../models/KYC.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";

const router = express.Router();

router.get("/profile", protect, async (req, res) => {
  try {
    const kyc = await KYC.findOne({ userId: req.user._id });
    const user = await User.findById(req.user._id).select("-password -otp");

    let kycStatus = "NOT_SUBMITTED";
    let kycRejectionReason = null;

    if (kyc) {
      if (kyc.status === "Pending") kycStatus = "PENDING_VERIFICATION";
      else if (kyc.status === "Approved") kycStatus = "VERIFIED";
      else if (kyc.status === "Rejected") {
        kycStatus = "REJECTED";
        kycRejectionReason = kyc.rejectionReason;
      }
    }

    res.json({
      ...user.toObject(),
      kycStatus,
      kycRejectionReason,
      isKycVerified: kycStatus === "VERIFIED",
      isMpinSet: !!user.mpin,
    });
  } catch (error) {
    console.error("Profile Error:", error);
    res.status(500).json({ msg: "Server error fetching profile" });
  }
});

// Update Profile Details
router.post("/update-profile", protect, async (req, res) => {
  const { name, phoneNumber } = req.body;
  try {
    const user = await User.findById(req.user._id);
    if (name) user.name = name;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    await user.save();
    res.json({ msg: "Profile updated successfully", user: { name: user.name, phoneNumber: user.phoneNumber } });
  } catch (err) {
    res.status(500).json({ msg: "Error updating profile" });
  }
});

// Request OTP for MPIN setup/reset (Forgot MPIN)
router.post("/request-mpin-otp", protect, async (req, res) => {
  try {
    const crypto = await import("crypto");
    const sendEmail = (await import("../utils/sendEmail.js")).default;
    const user = await User.findById(req.user._id);

    const otp = crypto.default.randomInt(100000, 999999).toString();
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(otp, salt);

    // Store OTP directly on user record (reusing existing otp/otpExpires fields)
    user.otp = otpHash;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await user.save();

    await sendEmail({
      email: user.email,
      subject: "OTP for MPIN Setup",
      message: `Your OTP for setting/resetting your MPIN is ${otp}. It is valid for 5 minutes. Do not share this with anyone.`,
    });

    res.json({ msg: "OTP sent to your registered email" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Error sending OTP" });
  }
});

// Verify OTP intermediate step (just checks correctness without clearing)
router.post("/verify-mpin-otp", protect, async (req, res) => {
  const { otp } = req.body;
  if (!otp) return res.status(400).json({ msg: "OTP is required" });

  try {
    const user = await User.findById(req.user._id);
    if (!user.otp || !user.otpExpires || user.otpExpires < new Date()) {
      return res.status(400).json({ msg: "OTP expired or not requested" });
    }

    const isMatch = await bcrypt.compare(otp.toString(), user.otp);
    if (!isMatch) return res.status(400).json({ msg: "Incorrect OTP" });

    res.json({ msg: "OTP verified successfully" });
  } catch (err) {
    res.status(500).json({ msg: "Error verifying OTP" });
  }
});


// Verify OTP and set new MPIN
router.post("/set-mpin-via-otp", protect, async (req, res) => {
  const { otp, newMpin, confirmMpin } = req.body;
  if (!otp || !newMpin || newMpin.length < 4) return res.status(400).json({ msg: "Invalid request" });
  if (newMpin !== confirmMpin) return res.status(400).json({ msg: "MPINs do not match" });

  try {
    const user = await User.findById(req.user._id);

    if (!user.otp || !user.otpExpires || user.otpExpires < new Date()) {
      return res.status(400).json({ msg: "OTP expired or not requested" });
    }

    const isMatch = await bcrypt.compare(otp.toString(), user.otp);
    if (!isMatch) return res.status(400).json({ msg: "Incorrect OTP" });

    const salt = await bcrypt.genSalt(10);
    user.mpin = await bcrypt.hash(newMpin, salt);
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    res.json({ msg: "MPIN set successfully" });
  } catch (err) {
    res.status(500).json({ msg: "Error setting MPIN" });
  }
});

// Verify MPIN (for quick check)
router.post("/verify-mpin", protect, async (req, res) => {
  const { mpin } = req.body;
  try {
    const user = await User.findById(req.user._id);
    if (!user.mpin) return res.status(400).json({ msg: "MPIN not set" });
    const isMatch = await bcrypt.compare(mpin.toString(), user.mpin);
    if (!isMatch) return res.status(400).json({ msg: "Incorrect MPIN" });
    res.json({ msg: "MPIN verified" });
  } catch (err) {
    res.status(500).json({ msg: "Error verifying MPIN" });
  }
});

// Add Bank Account
router.post("/bank-accounts", protect, async (req, res) => {
  const { accountNumber, ifsc, bankName, accountHolderName } = req.body;
  try {
    const user = await User.findById(req.user._id);
    user.bankAccounts.push({ accountNumber, ifsc, bankName, accountHolderName });
    await user.save();
    res.json({ msg: "Bank account added successfully", bankAccounts: user.bankAccounts });
  } catch (err) {
    res.status(500).json({ msg: "Error adding bank account" });
  }
});

// Add Nominee
router.post("/nominees", protect, async (req, res) => {
  const { name, relationship, allocation } = req.body;
  try {
    const user = await User.findById(req.user._id);
    user.nominees.push({ name, relationship, allocation });
    await user.save();
    res.json({ msg: "Nominee added successfully", nominees: user.nominees });
  } catch (err) {
    res.status(500).json({ msg: "Error adding nominee" });
  }
});

export default router;