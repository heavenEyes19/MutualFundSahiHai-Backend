import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
  },
  otpHash: {
    type: String,
    required: true,
  },
  action: {
    type: String,
    enum: ["WITHDRAWAL", "FUND_PURCHASE"],
    required: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed, // To store amount, bank, or fund details
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300, // 5 minutes TTL
  },
});

export default mongoose.model("OTP", otpSchema);
