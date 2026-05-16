import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true },
    password: String,
    role: {
      type: String,
      enum: ["investor", "admin"],
      default: "investor",
    },
    otp: { type: String, default: null },
    otpExpires: { type: Date, default: null },
    walletBalance: { type: Number, default: 0 },
    phoneNumber: { type: String, default: "" },
    mpin: { type: String, default: null }, // Hashed 4-6 digit PIN
    bankAccounts: [
      {
        accountNumber: String,
        ifsc: String,
        bankName: String,
        accountHolderName: String,
      },
    ],
    nominees: [
      {
        name: String,
        relationship: String,
        allocation: Number, // Percentage
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);