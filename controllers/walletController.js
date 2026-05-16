import Razorpay from "razorpay";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { sendNotification } from "../utils/notificationService.js";

const getRazorpayInstance = () => {
  return new Razorpay({
    key_id: (process.env.RAZORPAY_KEY_ID || "").trim(),
    key_secret: (process.env.RAZORPAY_KEY_SECRET || "").trim(),
  });
};

// Initiate topup
export const initiateTopup = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 100) {
      return res.status(400).json({ message: "Minimum top-up amount is ₹100" });
    }

    const instance = getRazorpayInstance();
    const options = {
      amount: amount * 100, // paise
      currency: "INR",
      receipt: `receipt_topup_${Math.floor(Math.random() * 10000)}`,
    };

    const order = await instance.orders.create(options);
    if (!order) return res.status(500).json({ message: "Failed to create order" });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Verify topup
export const verifyTopup = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
    const userId = req.user.id;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", (process.env.RAZORPAY_KEY_SECRET || "").trim())
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature !== expectedSign) {
      return res.status(400).json({ message: "Invalid signature sent!" });
    }

    // Idempotency check: see if we already processed this payment_id
    const existingTx = await WalletTransaction.findOne({ razorpayPaymentId: razorpay_payment_id });
    if (existingTx) {
      return res.status(400).json({ message: "Payment already processed" });
    }

    // Update wallet balance
    const user = await User.findById(userId);
    user.walletBalance += amount;
    await user.save();

    // Create transaction record
    const newTx = new WalletTransaction({
      user: userId,
      type: "TOPUP",
      amount: amount,
      status: "COMPLETED",
      description: "Top-up via Payment Gateway",
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
    });
    await newTx.save();

    await sendNotification({
      req,
      userId,
      title: "Money Added",
      message: `₹${amount} added to wallet successfully.`,
      type: "wallet",
      metadata: { txId: newTx._id, amount }
    });

    res.json({ message: "Top-up successful", balance: user.walletBalance });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to verify top-up" });
  }
};

// Get wallet details
export const getWalletDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    const transactions = await WalletTransaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(10);
    
    res.json({
      balance: user.walletBalance,
      transactions,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to fetch wallet details" });
  }
};

// Initiate withdraw — validate balance, return isMpinSet
export const initiateWithdraw = async (req, res) => {
  try {
    const { amount, bankAccount } = req.body;
    const userId = req.user.id;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const user = await User.findById(userId);
    if (user.walletBalance < amount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    res.json({
      message: "Proceed with MPIN verification",
      isMpinSet: !!user.mpin,
      amount,
      bankAccount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Verify MPIN and process withdrawal
export const verifyWithdraw = async (req, res) => {
  try {
    const { mpin, amount, bankAccount } = req.body;
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user.mpin) {
      return res.status(400).json({ message: "MPIN not set. Please set your MPIN first." });
    }

    const isMatch = await bcrypt.compare(mpin.toString(), user.mpin);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect MPIN" });
    }

    if (user.walletBalance < amount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    user.walletBalance -= amount;
    await user.save();

    const mockPayoutId = `pout_${crypto.randomInt(100000, 999999)}`;

    const newTx = new WalletTransaction({
      user: userId,
      type: "WITHDRAWAL",
      amount,
      status: "COMPLETED",
      description: `Withdrawal to Bank Account${bankAccount ? ` (${bankAccount})` : ''}`,
      razorpayPayoutId: mockPayoutId,
    });
    await newTx.save();

    await sendNotification({
      req,
      userId,
      title: "Withdrawal Successful",
      message: `₹${amount} transferred to bank.`,
      type: "wallet",
      metadata: { txId: newTx._id, amount }
    });

    res.json({ message: "Withdrawal processed successfully", balance: user.walletBalance });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to process withdrawal" });
  }
};
