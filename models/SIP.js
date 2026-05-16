import mongoose from "mongoose";

const sipSchema = new mongoose.Schema(
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
    amount: {
      type: Number,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    durationMonths: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "PAUSED", "STOPPED"],
      default: "ACTIVE",
    },
    nextDate: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("SIP", sipSchema);
