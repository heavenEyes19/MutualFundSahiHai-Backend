import Holding from "../models/Holding.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import KYC from "../models/KYC.js";
import SIP from "../models/SIP.js";
import { cacheGet, cacheSet, TTL } from "../utils/cache.js";

const parsePositiveNav = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Helper to get latest NAV — results are cached via the shared cache module.
const getLatestNav = async (schemeCode) => {
  const key    = `latest:${schemeCode}`;
  const cached = cacheGet(key);
  // The cache stores the full mfapi /latest response; we need the nav value.
  if (cached !== null) return parsePositiveNav(cached?.data?.[0]?.nav);

  try {
    const url        = new URL(`/mf/${schemeCode}/latest`, process.env.MFAPI_BASE_URL);
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 4000);
    const response   = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    const data = await response.json();
    cacheSet(key, data, TTL.NAV_LATEST); // share key with mutualFundController
    return parsePositiveNav(data?.data?.[0]?.nav);
  } catch (error) {
    console.error(`NAV fetch failed for ${schemeCode}:`, error.message);
    return null;
  }
};

export const getEnrichedPortfolioData = async (userId) => {
  const holdings = await Holding.find({ user: userId });

  let totalInvested = 0;
  let currentValue = 0;

  const enrichedHoldings = await Promise.all(
    holdings.map(async (h) => {
      let currentNav = await getLatestNav(h.schemeCode);
      const currentHoldingValue = currentNav ? h.units * currentNav : h.investedAmount;
      const invested = h.investedAmount;
      const gainLoss = ((currentHoldingValue - invested) / invested) * 100;
      totalInvested += invested;
      currentValue += currentHoldingValue;


      return {
        ...h.toObject(),
        currentNav,
        currentValue: currentHoldingValue,
        gainLossPercent: gainLoss,
      };
    })
  );

  const totalReturns = currentValue - totalInvested;
  const totalReturnsPercent = totalInvested > 0 ? (totalReturns / totalInvested) * 100 : 0;

  return {
    overview: {
      totalInvested,
      currentValue,
      totalReturns,
      totalReturnsPercent,
    },
    holdings: enrichedHoldings,
  };
};

export const getPortfolio = async (req, res) => {
  try {
    const data = await getEnrichedPortfolioData(req.user._id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Error fetching portfolio", error: error.message });
  }
};

export const buyFund = async (req, res) => {
  let { schemeCode, schemeName, amount, nav } = req.body;

  nav = parsePositiveNav(nav) || await getLatestNav(schemeCode);
  if (!nav) {
    return res.status(400).json({
      message: "Live NAV data is unavailable for this scheme. Transaction cannot proceed.",
    });
  }

  const units = amount / nav;

  try {
    const transaction = await Transaction.create({
      user: req.user._id,
      schemeCode,
      schemeName,
      type: "BUY",
      amount,
      nav,
      units,
    });

    let holding = await Holding.findOne({ user: req.user._id, schemeCode });
    if (holding) {
      const totalUnits = holding.units + units;
      const totalInvested = holding.investedAmount + amount;
      const newAvgNav = totalInvested / totalUnits;

      holding.units = totalUnits;
      holding.investedAmount = totalInvested;
      holding.avgNav = newAvgNav;
      await holding.save();
    } else {
      holding = await Holding.create({
        user: req.user._id,
        schemeCode,
        schemeName,
        units,
        avgNav: nav,
        investedAmount: amount,
      });
    }

    res.status(201).json({ message: "Fund purchased successfully", transaction, holding });
  } catch (error) {
    res.status(500).json({ message: "Error purchasing fund", error: error.message });
  }
};

export const sellFund = async (req, res) => {
  let { schemeCode, unitsToSell, currentNav } = req.body;

  currentNav = parsePositiveNav(currentNav) || await getLatestNav(schemeCode);
  if (!currentNav) {
    return res.status(400).json({
      message: "Live NAV data is unavailable for this scheme. Transaction cannot proceed.",
    });
  }

  try {
    let holding = await Holding.findOne({ user: req.user._id, schemeCode });
    if (!holding || holding.units < unitsToSell) {
      return res.status(400).json({ message: "Insufficient units to sell" });
    }

    const amount = unitsToSell * currentNav;

    const transaction = await Transaction.create({
      user: req.user._id,
      schemeCode,
      schemeName: holding.schemeName,
      type: "SELL",
      amount,
      nav: currentNav,
      units: unitsToSell,
    });

    holding.units -= unitsToSell;
    holding.investedAmount -= unitsToSell * holding.avgNav;

    if (holding.units <= 0) {
      await Holding.deleteOne({ _id: holding._id });
    } else {
      await holding.save();
    }

    const user = await User.findById(req.user._id);
    user.walletBalance += amount;
    await user.save();

    await WalletTransaction.create({
      user: req.user._id,
      type: "FUND_SALE",
      amount,
      status: "COMPLETED",
      description: `Sell ${holding.schemeName}`
    });

    res.json({ message: "Fund sold successfully", transaction, amount });
  } catch (error) {
    res.status(500).json({ message: "Error selling fund", error: error.message });
  }
};

export const getTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user._id }).sort({ date: -1 });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Error fetching transactions", error: error.message });
  }
};

export const reviewPortfolio = async (req, res) => {
  try {
    const [holdings, kyc, sips] = await Promise.all([
      Holding.find({ user: req.user._id }),
      KYC.findOne({ userId: req.user._id }),
      SIP.find({ user: req.user._id, status: "ACTIVE" })
    ]);

    const formattedHoldings = holdings.map(h => `${h.schemeName} (₹${h.investedAmount})`).join(", ");
    const kycStatus = kyc ? kyc.status : "Not completed";
    const sipsList = sips.map(s => `${s.schemeName} (₹${s.amount}/month)`).join(", ");

    let deterministicScore = 0;
    
    // KYC Approved is mandatory for any score > 0
    if (kyc && kyc.status === "Approved") {
      deterministicScore = 30; // Base score for being a verified investor
      
      // Investment Consistency (SIPs) - Max 30 points
      if (sips.length > 0) {
        deterministicScore += Math.min(30, sips.length * 10);
      }
      
      // Portfolio Variety (Holdings) - Max 30 points
      if (holdings.length > 0) {
        deterministicScore += Math.min(30, holdings.length * 6);
      }
      
      // Diversification Strategy - 10 points
      if (holdings.length >= 3) {
        deterministicScore += 10;
      }
    }

    let analysis = {
      healthScore: deterministicScore,
      healthBadge: deterministicScore >= 80 ? "Excellent" : deterministicScore >= 60 ? "Good" : deterministicScore > 0 ? "Fair" : "Unverified",
      healthText: deterministicScore > 0 ? `Better than ${Math.max(10, deterministicScore - 15)}% of investors` : "Complete KYC to see your health score",
      riskProfile: deterministicScore > 0 ? "Moderate" : "Undetermined",
      aiConfidence: deterministicScore > 0 ? 85 : 0,
      confidenceBadge: deterministicScore > 0 ? "High" : "N/A",
      confidenceText: deterministicScore > 0 ? "Strong recommendation" : "Awaiting verification"
    };

    if (process.env.GROQ_API_KEY) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `You are an expert AI portfolio analyzer. You review a user's mutual fund profile and give an assessment.
Output MUST be a JSON object with the following fields:
- healthScore (number EXACTLY matching the Provided Score)
- healthBadge (string, e.g., "Good", "Excellent", "Fair", "Poor" based on the score)
- healthText (string, e.g., "Better than X% of investors")
- riskProfile (string, e.g., "Conservative", "Moderate", "Aggressive")
- aiConfidence (number 1-100, usually 80-95)
- confidenceBadge (string, e.g., "High", "Medium", "Low")
- confidenceText (string, e.g., "Strong recommendation", "Needs review")`
              },
              {
                role: "user",
                content: `Analyze this portfolio:
Holdings: ${formattedHoldings || "No holdings yet"}
Active SIPs: ${sipsList || "No active SIPs"}
KYC Status: ${kycStatus}
Provided Score: ${deterministicScore}/100

Use the Provided Score EXACTLY for the healthScore field. Determine the riskProfile and confidence based on factors like KYC completeness, presence of multiple holdings/diversification, SIP consistency, and general risk/reward characteristics.`
              }
            ]
          })
        });

        const json = await response.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          analysis = JSON.parse(content);
        }
      } catch (aiError) {
        console.error("Groq AI Error:", aiError);
      }
    }

    res.json({
      ...analysis,
      lastReview: new Date()
    });

  } catch (error) {
    res.status(500).json({ message: "Error reviewing portfolio", error: error.message });
  }
};
