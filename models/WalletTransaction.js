import mongoose from "mongoose";

const walletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["TOPUP", "WITHDRAWAL", "FUND_PURCHASE", "FUND_SALE"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED"],
      default: "PENDING",
    },
    description: {
      type: String, // e.g., "Top-up via UPI", "Axis Bluechip Fund", "Withdrawal to HDFC Bank"
      required: true,
    },
    razorpayPaymentId: {
      type: String,
      unique: true,
      sparse: true, // Only for topups
    },
    razorpayOrderId: {
      type: String,
      sparse: true,
    },
    razorpayPayoutId: {
      type: String,
      sparse: true, // Only for withdrawals
    },
  },
  { timestamps: true }
);

export default mongoose.model("WalletTransaction", walletTransactionSchema);
