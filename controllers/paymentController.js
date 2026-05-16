import bcrypt from "bcryptjs";
import Transaction from "../models/Transaction.js";
import Holding from "../models/Holding.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

const parsePositiveNav = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Initiate Wallet Buy — checks balance, returns whether MPIN is set
export const initiateBuy = async (req, res) => {
  try {
    const { schemeCode, schemeName, amount, nav, items } = req.body;
    const itemsToProcess = items || [{ schemeCode, schemeName, amount, nav }];

    if (itemsToProcess.length === 0 || !itemsToProcess.every(item => parsePositiveNav(item.nav))) {
      return res.status(400).json({ message: "Invalid NAV data." });
    }

    const totalAmount = itemsToProcess.reduce((sum, item) => sum + Number(item.amount), 0);
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (user.walletBalance < totalAmount) {
      return res.status(400).json({ message: "Insufficient wallet balance." });
    }

    res.json({
      message: "Proceed with MPIN verification",
      isMpinSet: !!user.mpin,
      totalAmount,
      items: itemsToProcess,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to initiate purchase" });
  }
};

// Verify MPIN and execute purchase
export const verifyBuy = async (req, res) => {
  try {
    const { mpin, items, totalAmount } = req.body;
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user.mpin) {
      return res.status(400).json({ message: "MPIN not set. Please set your MPIN first." });
    }

    const isMatch = await bcrypt.compare(mpin.toString(), user.mpin);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect MPIN" });
    }

    const itemsToProcess = items || [];
    const amountToDeduct = totalAmount || itemsToProcess.reduce((s, i) => s + Number(i.amount), 0);

    if (user.walletBalance < amountToDeduct) {
      return res.status(400).json({ message: "Insufficient wallet balance." });
    }

    user.walletBalance -= amountToDeduct;
    await user.save();

    for (const item of itemsToProcess) {
      const validNav = parsePositiveNav(item.nav);
      if (!validNav) continue;

      const units = parseFloat((item.amount / validNav).toFixed(4));

      const newTransaction = new Transaction({
        user: userId,
        schemeCode: item.schemeCode,
        schemeName: item.schemeName,
        type: "BUY",
        amount: item.amount,
        nav: validNav,
        units,
      });
      await newTransaction.save();

      const walletTx = new WalletTransaction({
        user: userId,
        type: "FUND_PURCHASE",
        amount: item.amount,
        status: "COMPLETED",
        description: item.schemeName,
      });
      await walletTx.save();

      let holding = await Holding.findOne({ user: userId, schemeCode: item.schemeCode });
      if (holding) {
        holding.investedAmount += item.amount;
        holding.units += units;
        holding.avgNav = holding.investedAmount / holding.units;
        await holding.save();
      } else {
        holding = new Holding({
          user: userId,
          schemeCode: item.schemeCode,
          schemeName: item.schemeName,
          units,
          avgNav: validNav,
          investedAmount: item.amount,
        });
        await holding.save();
      }
    }

    res.json({ message: "Purchase successful", balance: user.walletBalance });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to verify purchase" });
  }
};
