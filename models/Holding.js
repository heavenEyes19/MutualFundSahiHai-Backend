import mongoose from "mongoose";

const holdingSchema = new mongoose.Schema(
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
    units: {
      type: Number,
      required: true,
      default: 0,
    },
    avgNav: {
      type: Number,
      required: true,
      default: 0,
    },
    investedAmount: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Holding", holdingSchema);
