import SIP from "../models/SIP.js";
import Transaction from "../models/Transaction.js";
import Holding from "../models/Holding.js";

const parsePositiveNav = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getLatestNav = async (schemeCode) => {
  try {
    const url = new URL(`/mf/${schemeCode}/latest`, process.env.MFAPI_BASE_URL);
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return parsePositiveNav(data?.data?.[0]?.nav);
  } catch {
    return null;
  }
};

export const getSIPs = async (req, res) => {
  try {
    const sips = await SIP.find({ user: req.user._id });
    res.json(sips);
  } catch (error) {
    res.status(500).json({ message: "Error fetching SIPs", error: error.message });
  }
};

export const createSIP = async (req, res) => {
  const { schemeCode, schemeName, amount, startDate, durationMonths } = req.body;
  
  try {
    const latestNav = await getLatestNav(schemeCode);
    if (!latestNav) {
      return res.status(400).json({
        message: "Live NAV data is unavailable for this scheme. SIP cannot be created.",
      });
    }

    const sip = await SIP.create({
      user: req.user._id,
      schemeCode,
      schemeName,
      amount,
      startDate: new Date(startDate),
      durationMonths,
      nextDate: new Date(startDate),
    });

    res.status(201).json({ message: "SIP created successfully", sip });
  } catch (error) {
    res.status(500).json({ message: "Error creating SIP", error: error.message });
  }
};

export const updateSIP = async (req, res) => {
  const { status, amount } = req.body;
  
  try {
    const sip = await SIP.findOne({ _id: req.params.id, user: req.user._id });
    if (!sip) {
      return res.status(404).json({ message: "SIP not found" });
    }

    if (status) sip.status = status;
    if (amount) sip.amount = amount;
    
    await sip.save();
    res.json({ message: "SIP updated successfully", sip });
  } catch (error) {
    res.status(500).json({ message: "Error updating SIP", error: error.message });
  }
};

// A mock endpoint to simulate an SIP running for a month
export const executeSIP = async (req, res) => {
  try {
    const sip = await SIP.findOne({ _id: req.params.id, user: req.user._id });
    if (!sip) {
      return res.status(404).json({ message: "SIP not found" });
    }
    if (sip.status !== "ACTIVE") {
        return res.status(400).json({ message: "SIP is not active" });
    }

    // Mock NAV for the execution
    const mockNav = 150 + Math.random() * 20; 
    const units = sip.amount / mockNav;

    // Create transaction
    const transaction = await Transaction.create({
      user: req.user._id,
      schemeCode: sip.schemeCode,
      schemeName: sip.schemeName,
      type: "SIP",
      amount: sip.amount,
      nav: mockNav,
      units,
      date: sip.nextDate,
    });

    // Update holding
    let holding = await Holding.findOne({ user: req.user._id, schemeCode: sip.schemeCode });
    if (holding) {
      const totalUnits = holding.units + units;
      const totalInvested = holding.investedAmount + sip.amount;
      holding.avgNav = totalInvested / totalUnits;
      holding.units = totalUnits;
      holding.investedAmount = totalInvested;
      await holding.save();
    } else {
      await Holding.create({
        user: req.user._id,
        schemeCode: sip.schemeCode,
        schemeName: sip.schemeName,
        units,
        avgNav: mockNav,
        investedAmount: sip.amount,
      });
    }

    // Advance nextDate by 1 month
    const nextDate = new Date(sip.nextDate);
    nextDate.setMonth(nextDate.getMonth() + 1);
    sip.nextDate = nextDate;
    await sip.save();

    res.json({ message: "SIP executed successfully", transaction, sip });
  } catch (error) {
    res.status(500).json({ message: "Error executing SIP", error: error.message });
  }
};
