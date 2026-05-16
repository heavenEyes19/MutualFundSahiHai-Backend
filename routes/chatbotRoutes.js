import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import Holding from "../models/Holding.js";
import SIP from "../models/SIP.js";
import KYC from "../models/KYC.js";
import User from "../models/User.js";
import { getEnrichedPortfolioData } from "../controllers/portfolioController.js";

const router = express.Router();

const MFAPI = "https://api.mfapi.in/mf";

// ─── Detect "X vs Y" and extract terms directly (no Groq needed) ─────────
function extractCompareTerms(query) {
  const match = query.match(/(?:compare\s+)?(.+?)\s+vs\.?\s+(.+)/i);
  return match ? [match[1].trim(), match[2].trim()] : null;
}

// ─── Step 1: Ask Groq for short searchable fund keywords ─────────────────
async function getFundNamesFromAI(userMsg, portfolioText) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a mutual fund search keyword generator for the Indian market.
Output a JSON object with a "keywords" array containing 1-3 short fund search keywords.

RULES:
- ONLY return a JSON object
- No explanation
- Keep keywords short (e.g. "HDFC Top 100", "SBI Bluechip")
- The user's current portfolio is: ${portfolioText}
- If the user asks to compare or get data about a fund they already own (e.g., "my HDFC fund"), use the exact scheme name from their portfolio.
- CRITICAL: If the user is asking for general portfolio analysis without requesting specific fund data (e.g., "Analyze my portfolio", "Am I diversified enough?"), return {"keywords": []}. DO NOT invent or guess fund names.
- ONLY output keywords if the user explicitly asks for external fund suggestions (e.g., "Best funds for long term") or mentions a specific fund by name.`,
        },
        { role: "user", content: userMsg },
      ],
    }),
  });

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content?.trim() || '{"keywords": []}';

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 3) : [];
  } catch {
    return [];
  }
}

// ─── Step 2: Search MFAPI ────────────────────────────────────────────────
async function resolveSchemeCodes(fundName) {
  try {
    const res = await fetch(`${MFAPI}/search?q=${encodeURIComponent(fundName)}`);
    const schemes = await res.json();
    if (!Array.isArray(schemes) || !schemes.length) return [];

    return schemes
      .slice(0, 10)
      .sort((a, b) => {
        const score = (s) =>
          (/direct/i.test(s.schemeName) ? 2 : 0) +
          (/growth/i.test(s.schemeName) ? 1 : 0);
        return score(b) - score(a);
      })
      .slice(0, 5)
      .map((s) => s.schemeCode);
  } catch {
    return [];
  }
}

// ─── Step 3: Fetch NAV data ──────────────────────────────────────────────
async function fetchFundData(schemeCode) {
  try {
    const res = await fetch(`${MFAPI}/${schemeCode}`);
    if (!res.ok) return null;

    const { meta, data } = await res.json();
    if (!data?.length || !meta?.scheme_name) return null;

    const navValues = data.map((d) => Number(d.nav));
    const latest = navValues[0];
    const past = navValues.length >= 90 ? navValues[89] : navValues[navValues.length - 1];
    const change90 = past ? ((latest - past) / past) * 100 : 0;

    return {
      name: meta.scheme_name,
      nav: latest,
      date: data[0].date,
      change90,
      minNAV: Math.min(...navValues),
      maxNAV: Math.max(...navValues),
    };
  } catch {
    return null;
  }
}

// ─── Resolve fund data ───────────────────────────────────────────────────
async function resolveFundData(fundName) {
  const codes = await resolveSchemeCodes(fundName);
  if (!codes.length) return null;

  const results = await Promise.all(codes.map(fetchFundData));
  return results.find(Boolean) || null;
}

// ─── Step 4: Groq summary (ALWAYS runs) ──────────────────────────────────
async function getSummary(userMsg, fundsData, portfolioText, detailed = false) {

  const makeError = (conclusion, simpleWords) => ({
    contextLabel: "AI Advisor",
    contextUsed: [],
    verdict: { status: "Error", conclusion, color: "red" },
    insights: [],
    simpleWords,
    suggestedActions: [],
    detailedAnalysis: ""
  });

  try {
    const hasFunds = fundsData && fundsData.length > 0;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a personalized AI investment advisor for the Indian market. You deeply understand the user's portfolio and financial behavior.
You MUST consider the user's COMPLETE portfolio before generating any recommendation, comparison, insight, or response. Avoid generic recommendations.
Avoid isolated single-fund analysis. If the user asks about a new fund, explain how it affects their existing portfolio (overlap, diversification impact, risk).

Portfolio context:
${portfolioText}

CRITICAL: You MUST output ONLY valid JSON matching this exact structure:
{
  "contextLabel": "e.g. Portfolio Analysis, Risk Review, Fund Comparison",
  "contextUsed": ["Holdings analyzed", "Risk profile considered", "Allocation analyzed", "SIP history checked"],
  "verdict": {
    "status": "e.g. Good, Warning, Excellent, Alert, Neutral",
    "conclusion": "A concise 1-2 line conclusion on how this affects their portfolio",
    "color": "emerald, amber, red, or blue"
  },
  "insights": [
    {
      "title": "e.g. Good Diversification, High Overlap",
      "description": "One-line simple explanation, specifically calculating portfolio impact if applicable.",
      "iconType": "TrendingUp",
      "color": "emerald"
    }
  ],
  "simpleWords": "Translate any jargon into a beginner-friendly 1-2 sentence explanation.",
  "suggestedActions": ["Rebalance Portfolio", "Start SIP", "Reduce Overlap", "View Fund Details"],
  "detailedAnalysis": "More advanced explanation including any specific fund category recommendations, before/after equity exposure calculations, risk level changes, and balance impact. If recommending fund types or categories (e.g. debt funds, index funds, ELSS), include those descriptions HERE with supporting details."
}

STRICT RULES for suggestedActions:
- Each action MUST be a SHORT verb phrase of 2-4 words only (e.g. "Start SIP", "Rebalance Portfolio", "Reduce Overlap").
- NEVER include fund names, fund categories, or long sentences in suggestedActions.
- NEVER use suggestedActions for investment advice like "Start with large-cap funds" or "Consider index funds".
- All fund category recommendations, specific fund names, and investment strategy details MUST go inside detailedAnalysis only.

Limit insights to 2-4 items. iconType must be one of: TrendingUp, TrendingDown, PieChart, Calendar, Shield, Target, AlertCircle.

${detailed
  ? `RESPONSE MODE: DETAILED — Give a thorough, comprehensive analysis. Fill in detailedAnalysis with at least 3-5 paragraphs including category recommendations, risk calculations, before/after impact, and strategy. simpleWords can be 3-4 sentences.`
  : `RESPONSE MODE: COMPACT — Be concise. Fill simpleWords with only 1-2 crisp, clear sentences. Keep verdict.conclusion under 15 words. Keep detailedAnalysis very short (1-2 sentences max) or empty. Skip insights if not critical.`
}`
          },
          {
            role: "user",
            content: hasFunds
              ? `Question: "${userMsg}"\nFunds: ${fundsData.map((f) => f.name).join(", ")}`
              : userMsg,
          },
        ],
      }),
    });

    // Log HTTP-level errors from Groq (rate limit, bad key, quota exceeded, etc.)
    if (!res.ok) {
      const errBody = await res.text().catch(() => "(no body)");
      console.error(`[Groq] HTTP ${res.status} ${res.statusText}:`, errBody);
      const hint = res.status === 401
        ? "Invalid or missing GROQ_API_KEY."
        : res.status === 429
          ? "Groq rate limit reached. Please wait a moment and try again."
          : `Groq API returned HTTP ${res.status}.`;
      return makeError(hint, hint);
    }

    const json = await res.json();

    // Groq returned a valid HTTP 200 but the payload is an error object
    if (json.error) {
      console.error("[Groq] API error object:", JSON.stringify(json.error));
      return makeError(
        `Groq error: ${json.error.message ?? "Unknown error"}`,
        "The AI service returned an error. Please try again in a moment."
      );
    }

    const raw = json.choices?.[0]?.message?.content?.trim();

    // No content at all
    if (!raw) {
      console.error("[Groq] Empty content. Full response:", JSON.stringify(json));
      return makeError(
        "Groq returned an empty response.",
        "The AI returned no content. Please rephrase your question or try again."
      );
    }

    try {
      const parsed = JSON.parse(raw);

      // Sanity check: if we got {} or a completely empty object, treat it as an error
      if (!parsed.simpleWords && !parsed.verdict && !parsed.detailedAnalysis) {
        console.warn("[Groq] Parsed JSON is empty/missing all fields:", raw);
        return makeError(
          "AI response had no useful content.",
          "The AI returned an empty answer. Please try rephrasing your question."
        );
      }

      return parsed;
    } catch (parseErr) {
      console.warn("[Groq] JSON parse failed, raw content:", raw);
      return {
        contextLabel: "AI Advisor",
        contextUsed: [],
        verdict: { status: "Notice", conclusion: "Response was not structured JSON.", color: "blue" },
        insights: [],
        simpleWords: raw.replace(/\*+/g, "").replace(/\n{3,}/g, "\n\n").trim(),
        suggestedActions: [],
        detailedAnalysis: ""
      };
    }
  } catch (networkErr) {
    console.error("[Groq] Network/fetch error:", networkErr);
    return makeError(
      "Could not reach the Groq API. Check your server's internet connection.",
      "Network error connecting to AI service. Please try again."
    );
  }
}

// ─── Main route ───────────────────────────────────────────────────────────
router.post("/chatbot", protect, async (req, res) => {
  try {
    const userMsg = req.body.message?.trim();
    const detailed = req.body.detailed === true; // compact by default

    if (!userMsg)
      return res.status(400).json({ reply: "Empty message." });

    // Fetch user portfolio + SIP + KYC for deep RAG context
    const [portfolioData, sips, kyc] = await Promise.all([
      getEnrichedPortfolioData(req.user._id),
      SIP.find({ user: req.user._id, status: "ACTIVE" }),
      KYC.findOne({ userId: req.user._id })
    ]);

    let portfolioText = "User has no mutual fund holdings currently.";

    if (portfolioData && portfolioData.holdings.length > 0) {
      const { overview, holdings } = portfolioData;

      let equityCount = 0;
      let debtCount = 0;
      let hybridCount = 0;

      const holdingsStr = holdings.map(h => {
        const name = h.schemeName.toLowerCase();
        let cat = "Other";
        if (name.includes("equity") || name.includes("bluechip") || name.includes("midcap") || name.includes("small") || name.includes("flexi")) {
          cat = "Equity";
          equityCount++;
        } else if (name.includes("debt") || name.includes("liquid") || name.includes("gilt") || name.includes("income")) {
          cat = "Debt";
          debtCount++;
        } else if (name.includes("hybrid") || name.includes("balanced")) {
          cat = "Hybrid";
          hybridCount++;
        }
        return `- ${h.schemeName} (${cat}): Invested ₹${h.investedAmount.toFixed(0)}, Current Value ₹${h.currentValue.toFixed(0)}, Return: ${h.gainLossPercent.toFixed(2)}%`;
      }).join("\n");

      const sipStr = sips.length > 0 ? sips.map(s => `- ${s.schemeName}: ₹${s.amount}/month`).join("\n") : "No active SIPs";
      const kycStatus = kyc ? kyc.status : "Not completed";

      let divScore = 0;
      if (equityCount > 0) divScore += 33;
      if (debtCount > 0) divScore += 33;
      if (hybridCount > 0) divScore += 34;

      portfolioText = `
--- COMPLETE PORTFOLIO CONTEXT ---
Total Portfolio Value: ₹${overview.currentValue.toFixed(0)}
Total Invested: ₹${overview.totalInvested.toFixed(0)}
Total Returns: ₹${overview.totalReturns.toFixed(0)} (${overview.totalReturnsPercent.toFixed(2)}%)
KYC Status: ${kycStatus}
Broad Asset Allocation: Equity (${equityCount}), Debt (${debtCount}), Hybrid (${hybridCount})
Approx Diversification Score: ${divScore}/100

Current Holdings:
${holdingsStr}

Active SIP History:
${sipStr}
----------------------------------`;
    }

    const fundNames =
      extractCompareTerms(userMsg) ||
      (await getFundNamesFromAI(userMsg, portfolioText));

    // Only resolve fund data if the AI actually identified relevant fund keywords
    const fundsData = fundNames?.length
      ? (await Promise.all(fundNames.map(resolveFundData))).filter(Boolean)
      : [];

    // ✅ ALWAYS generate reply (with or without data), pass detailed flag
    const reply = await getSummary(userMsg, fundsData, portfolioText, detailed);

    res.json({
      reply,
      funds: fundsData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      reply: {
        contextLabel: "Error",
        contextUsed: [],
        verdict: { status: "Error", conclusion: "Something went wrong on the server. Please try again.", color: "red" },
        insights: [],
        simpleWords: "An unexpected error occurred. Please refresh and try again.",
        suggestedActions: [],
        detailedAnalysis: ""
      },
      funds: []
    });
  }
});

// ─── Quick Insight Route (for Explore Page) ──────────────────────────────
router.get("/insight", protect, async (req, res) => {
  try {
    const [portfolioData, user] = await Promise.all([
      getEnrichedPortfolioData(req.user._id),
      User.findById(req.user._id)
    ]);

    const walletBalance = user?.walletBalance || 0;
    let totalInvested = 0;
    let portfolioInfo = "No mutual fund investments yet.";

    if (portfolioData && portfolioData.holdings.length > 0) {
      totalInvested = portfolioData.overview.totalInvested;
      portfolioInfo = `Total Invested: ₹${totalInvested.toFixed(0)}, Current Value: ₹${portfolioData.overview.currentValue.toFixed(0)}, Returns: ${portfolioData.overview.totalReturnsPercent.toFixed(2)}%. Top holdings: ${portfolioData.holdings.slice(0, 2).map(h => h.schemeName).join(", ")}.`;
    }

    const promptText = `
You are a financial AI advisor. The user is visiting their dashboard.
User Wallet Balance: ₹${walletBalance}
User Portfolio: ${portfolioInfo}

Generate ONE quick, highly personalized financial insight for them in JSON format.
Keep it strictly under 2 sentences. 
Example JSON:
{
  "title": "Idle Wallet Funds",
  "message": "You have ₹10,000 sitting idle. Consider starting a SIP in a Flexi Cap fund to beat inflation."
}
Do not use markdown formatting outside the JSON block. Only return valid JSON.`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: promptText }]
      }),
    });

    if (!groqRes.ok) {
      return res.status(200).json({ title: "Smart Investing", message: "A diversified portfolio is key to long term wealth. Explore our top mutual funds today." });
    }

    const json = await groqRes.json();
    const raw = json.choices?.[0]?.message?.content?.trim();
    
    try {
      const parsed = JSON.parse(raw);
      res.status(200).json(parsed);
    } catch {
      res.status(200).json({ title: "Keep Investing", message: "Consistency is the secret to building a great financial legacy." });
    }

  } catch (error) {
    console.error("AI insight error:", error);
    res.status(200).json({ title: "Market Insight", message: "Systematic Investment Plans (SIPs) help average out market volatility over time." });
  }
});

export default router;
