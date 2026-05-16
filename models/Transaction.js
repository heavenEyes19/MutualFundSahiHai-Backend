import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    schemeCode: {
      type: Number,
      required: true,
    },
    schemeName: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["BUY", "SELL", "SIP"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    nav: {
      type: Number,
      required: true,
    },
    units: {
      type: Number,
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Transaction", transactionSchema);
