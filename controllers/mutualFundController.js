import { cacheGet, cacheSet, TTL } from "../utils/cache.js";

const DEFAULT_LIST_LIMIT   = 12;
const DEFAULT_SEARCH_LIMIT = 15;
const MAX_LIMIT            = 50;

// A fund whose latest NAV is older than this many years is inactive/archived.
const INACTIVE_THRESHOLD_YEARS = 3;

// ─── Param helpers ────────────────────────────────────────────────────────────
const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};
const getLimit      = (v, fb) => Math.min(parsePositiveInteger(v, fb), MAX_LIMIT);
const getOffset     = (v)     => { const p = Number.parseInt(v, 10); return Number.isNaN(p) || p < 0 ? 0 : p; };
const getSchemeCode = (v)     => { const p = Number.parseInt(v, 10); return Number.isNaN(p) || p <= 0 ? null : p; };

// ─── NAV age helper ───────────────────────────────────────────────────────────
/** Returns the age in years of a "DD-MM-YYYY" NAV date string (Infinity if unparseable). */
const getNavAgeYears = (navDateStr) => {
  if (!navDateStr) return Infinity;
  const parts = navDateStr.split("-").map(Number);
  if (parts.length !== 3) return Infinity;
  const [day, month, year] = parts;
  return (Date.now() - new Date(year, month - 1, day).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
};

// ─── Return calculation helper ────────────────────────────────────────────────
const calculateReturns = (navData) => {
  if (!navData || navData.length < 2) return { return1y: null, return3y: null, return5y: null };
  
  const latest = navData[0];
  const latestNav = parseFloat(latest.nav);
  if (isNaN(latestNav)) return { return1y: null, return3y: null, return5y: null };

  const [d, m, y] = latest.date.split("-").map(Number);

  const getReturn = (years) => {
    const targetDate = new Date(y - years, m - 1, d);
    let closestNav = null;
    let minDiff = Infinity;

    for (const entry of navData) {
      const [ed, em, ey] = entry.date.split("-").map(Number);
      const eDate = new Date(ey, em - 1, ed);
      const diff = Math.abs(targetDate - eDate);
      if (diff < minDiff) {
        minDiff = diff;
        closestNav = parseFloat(entry.nav);
      }
      // If we are significantly past the target date, stop searching
      if (eDate < targetDate && diff > 15 * 24 * 60 * 60 * 1000) break;
    }

    if (minDiff <= 15 * 24 * 60 * 60 * 1000 && closestNav) {
      return (((latestNav - closestNav) / closestNav) * 100).toFixed(2);
    }
    return null;
  };

  return {
    return1y: getReturn(1),
    return3y: getReturn(3),
    return5y: getReturn(5)
  };
};

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
const buildMfApiUrl = (path, query = {}) => {
  const url = new URL(path, process.env.MFAPI_BASE_URL);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return url.toString();
};

/**
 * Fetches from mfapi with an optional AbortSignal.
 * Always throws on non-2xx so callers can catch uniformly.
 */
const fetchFromMfApi = async (path, query = {}, signal) => {
  const response = await fetch(buildMfApiUrl(path, query), signal ? { signal } : undefined);
  if (!response.ok) {
    let msg = `MF API ${response.status}`;
    try { const t = await response.text(); if (t) msg = t; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }
  return response.json();
};

/**
 * Fetches from mfapi, checking the shared cache first.
 * cacheKey  – unique string for this request
 * ttlMs     – how long to cache a successful response
 */
const cachedFetch = async (cacheKey, path, query = {}, ttlMs) => {
  const hit = cacheGet(cacheKey);
  if (hit !== null) return hit;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 8000); // 8 s hard timeout
  try {
    const data = await fetchFromMfApi(path, query, controller.signal);
    clearTimeout(timeoutId);
    cacheSet(cacheKey, data, ttlMs);
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
};

const sendMfApiError = (res, error, message) =>
  res.status(error.status === 404 ? 404 : 502).json({ message, error: error.message });

// ─── Scheme classifier ────────────────────────────────────────────────────────
/**
 * Enriches a raw scheme object with `navDate` and `isActive`.
 * Uses cache.js so results persist for 6 hours.
 */
const classifyScheme = async (scheme) => {
  const cacheKey = `classify:full:${scheme.schemeCode}`;
  const hit = cacheGet(cacheKey);
  if (hit !== null) return hit;

  try {
    const details = await cachedFetch(
      `details:full:${scheme.schemeCode}`,
      `/mf/${scheme.schemeCode}`,
      {},
      TTL.FUND_DETAILS
    );

    const navData = details?.data || [];
    const navDate = navData[0]?.date ?? null;
    const returns = calculateReturns(navData);

    const result = { 
      ...scheme, 
      navDate, 
      isActive: getNavAgeYears(navDate) <= INACTIVE_THRESHOLD_YEARS,
      ...returns
    };
    cacheSet(cacheKey, result, TTL.CLASSIFY);
    return result;
  } catch {
    const result = { ...scheme, navDate: null, isActive: true, return1y: null, return3y: null, return5y: null };
    cacheSet(cacheKey, result, TTL.CLASSIFY_ERR); // retry soon on error
    return result;
  }
};

/**
 * Classifies an array of schemes with concurrency=5 to avoid
 * overloading mfapi's DNS on cold starts.
 * Most results will be cache hits after the first request.
 */
const classifySchemes = async (schemes, concurrency = 5) => {
  const results = [];
  for (let i = 0; i < schemes.length; i += concurrency) {
    const batch = schemes.slice(i, i + concurrency);
    const out   = await Promise.all(batch.map(classifyScheme));
    results.push(...out);
  }
  return results;
};

// ─── Route handlers ───────────────────────────────────────────────────────────
export const listMutualFunds = async (req, res) => {
  const limit    = getLimit(req.query.limit, DEFAULT_LIST_LIMIT);
  const offset   = getOffset(req.query.offset);
  const poolSize = Math.min(limit * 2, 24); // conservative pool: max 24 schemes → 24 classify calls

  try {
    // Cache the raw scheme list (scheme codes + names only — very stable)
    const raw        = await cachedFetch(`list:${poolSize}:${offset}`, "/mf", { limit: poolSize, offset }, TTL.FUND_LIST);
    const allSchemes = Array.isArray(raw) ? raw : [];

    // Classification results are individually cached — only uncached ones hit mfapi
    const classified  = await classifySchemes(allSchemes);
    const active      = classified.filter((s) =>  s.isActive);
    const historical  = classified.filter((s) => !s.isActive);

    res.json({
      active:     active.slice(0, limit),
      historical: historical.slice(0, limit),
      counts:     { active: active.length, historical: historical.length },
      schemes:    active.slice(0, limit), // backward compat
      pagination: { limit, offset, count: active.length },
    });
  } catch (error) {
    sendMfApiError(res, error, "Unable to load mutual fund schemes right now.");
  }
};

export const searchMutualFunds = async (req, res) => {
  const query = req.query.q?.trim();
  if (!query || query.length < 2) {
    return res.status(400).json({ message: "Search query must be at least 2 characters long." });
  }
  const limit = getLimit(req.query.limit, DEFAULT_SEARCH_LIMIT);

  try {
    // Cache search results — the scheme list itself is stable; only NAV dates change
    const raw        = await cachedFetch(`search:${query.toLowerCase()}`, "/mf/search", { q: query }, TTL.SEARCH);
    const allSchemes = Array.isArray(raw) ? raw.slice(0, limit * 4) : [];

    const classified = await classifySchemes(allSchemes);
    const active     = classified.filter((s) =>  s.isActive);
    const historical = classified.filter((s) => !s.isActive);

    res.json({
      query,
      active:     active.slice(0, limit),
      historical: historical.slice(0, limit),
      counts:     { active: active.length, historical: historical.length },
      schemes:    classified.slice(0, limit),
      total:      classified.length,
    });
  } catch (error) {
    sendMfApiError(res, error, "Unable to search mutual funds right now.");
  }
};

export const getMutualFundDetails = async (req, res) => {
  const schemeCode = getSchemeCode(req.params.schemeCode);
  if (!schemeCode) {
    return res.status(400).json({ message: "A valid mutual fund scheme code is required." });
  }

  try {
    // Historical NAV data never changes retroactively — safe to cache for 12 hours.
    // We always fetch the FULL history (no date range) so the chart always renders.
    const [details, latestNav] = await Promise.all([
      cachedFetch(`details:full:${schemeCode}`, `/mf/${schemeCode}`, {}, TTL.FUND_DETAILS),
      cachedFetch(`latest:${schemeCode}`,       `/mf/${schemeCode}/latest`, {}, TTL.NAV_LATEST),
    ]);

    const latest  = Array.isArray(latestNav?.data) ? latestNav.data[0] || null : null;
    const navData = Array.isArray(details?.data)   ? details.data              : [];

    res.json({
      ...details,
      data:   navData,
      latest,
    });
  } catch (error) {
    sendMfApiError(res, error, "Unable to load mutual fund details right now.");
  }
};

export const getLatestMutualFundNav = async (req, res) => {
  const schemeCode = getSchemeCode(req.params.schemeCode);
  if (!schemeCode) {
    return res.status(400).json({ message: "A valid mutual fund scheme code is required." });
  }
  try {
    const latestNav = await cachedFetch(`latest:${schemeCode}`, `/mf/${schemeCode}/latest`, {}, TTL.NAV_LATEST);
    res.json(latestNav);
  } catch (error) {
    sendMfApiError(res, error, "Unable to load the latest NAV right now.");
  }
};

// ─── Explore Page Helpers & Endpoints (Real Data via Curated List) ─────────────

// Curated list of popular funds with their scheme codes mapped to SEBI categories
const CURATED_FUNDS = [
  { schemeCode: 122639, schemeName: "Parag Parikh Flexi Cap Fund", category: "Flexi Cap", riskLevel: "High", amc: "PPFAS", aum: "₹50,000 Cr", expenseRatio: "0.65%", collections: ["High Growth", "Long-Term Wealth"] },
  { schemeCode: 125497, schemeName: "SBI Small Cap Fund", category: "Small Cap", riskLevel: "Very High", amc: "SBI", aum: "₹25,000 Cr", expenseRatio: "0.70%", collections: ["Best SIP Funds", "High Growth"] },
  { schemeCode: 118778, schemeName: "Nippon India Small Cap Fund", category: "Small Cap", riskLevel: "Very High", amc: "Nippon India", aum: "₹40,000 Cr", expenseRatio: "0.75%", collections: ["High Growth"] },
  { schemeCode: 120186, schemeName: "ICICI Prudential US Bluechip Equity Fund", category: "Large Cap", riskLevel: "High", amc: "ICICI Prudential", aum: "₹10,000 Cr", expenseRatio: "0.85%", collections: ["Funds for Beginners"] },
  { schemeCode: 118825, schemeName: "Mirae Asset Large Cap Fund", category: "Large Cap", riskLevel: "High", amc: "Mirae Asset", aum: "₹35,000 Cr", expenseRatio: "0.55%", collections: ["Funds for Beginners", "Best SIP Funds"] },
  { schemeCode: 120503, schemeName: "Axis Bluechip Fund", category: "Large Cap", riskLevel: "High", amc: "Axis", aum: "₹30,000 Cr", expenseRatio: "0.62%", collections: ["Funds for Beginners"] },
  { schemeCode: 112932, schemeName: "HDFC Index Fund - Nifty 50 Plan", category: "Index", riskLevel: "High", amc: "HDFC", aum: "₹15,000 Cr", expenseRatio: "0.20%", collections: ["Low Risk Funds"] },
  { schemeCode: 120586, schemeName: "Quant Active Fund", category: "Multi Cap", riskLevel: "Very High", amc: "Quant", aum: "₹8,000 Cr", expenseRatio: "0.77%", collections: ["High Growth"] },
  { schemeCode: 118989, schemeName: "HDFC Taxsaver Fund", category: "ELSS", riskLevel: "High", amc: "HDFC", aum: "₹12,000 Cr", expenseRatio: "0.80%", collections: ["Tax Saving Funds"] },
  { schemeCode: 120505, schemeName: "Axis Long Term Equity Fund", category: "ELSS", riskLevel: "High", amc: "Axis", aum: "₹28,000 Cr", expenseRatio: "0.72%", collections: ["Tax Saving Funds"] },
];

/**
 * Calculates real 1Y, 3Y, 5Y CAGR from raw NAV array [{ date: "DD-MM-YYYY", nav: "..." }, ...]
 * Assumes NAV array is sorted descending by date (latest first), as returned by mfapi.in
 */
const calculateRealReturns = (navData) => {
  if (!navData || navData.length === 0) return { returns1Y: 0, returns3Y: 0, returns5Y: 0 };
  
  const parseDate = (d) => { const parts = d.split('-'); return new Date(parts[2], parts[1]-1, parts[0]); };
  
  const latestNavItem = navData[0];
  const latestDate = parseDate(latestNavItem.date);
  const latestNavVal = parseFloat(latestNavItem.nav);

  const getNavValAtYearsAgo = (years) => {
    const targetDate = new Date(latestDate);
    targetDate.setFullYear(targetDate.getFullYear() - years);
    
    // Find the closest NAV date that is on or before the target date
    let closestNavVal = null;
    let minDiff = Infinity;
    
    for (const item of navData) {
      const itemDate = parseDate(item.date);
      const diffDays = Math.abs((itemDate - targetDate) / (1000 * 60 * 60 * 24));
      if (diffDays < minDiff && itemDate <= targetDate) {
        minDiff = diffDays;
        closestNavVal = parseFloat(item.nav);
        // Break early if we found a very close match (within 5 days) to save iterations
        if (minDiff < 5) break; 
      }
    }
    return closestNavVal;
  };

  const calcCagr = (pastVal, currentVal, years) => {
    if (!pastVal || pastVal <= 0 || years <= 0) return null;
    return (Math.pow(currentVal / pastVal, 1 / years) - 1) * 100;
  };

  const nav1Y = getNavValAtYearsAgo(1);
  const nav3Y = getNavValAtYearsAgo(3);
  const nav5Y = getNavValAtYearsAgo(5);

  return {
    returns1Y: nav1Y ? parseFloat(calcCagr(nav1Y, latestNavVal, 1).toFixed(2)) : null,
    returns3Y: nav3Y ? parseFloat(calcCagr(nav3Y, latestNavVal, 3).toFixed(2)) : null,
    returns5Y: nav5Y ? parseFloat(calcCagr(nav5Y, latestNavVal, 5).toFixed(2)) : null,
    currentNav: latestNavVal
  };
};

/**
 * Enriches a curated fund with real-time NAV and returns from mfapi
 */
const enrichCuratedFund = async (fund) => {
  const cacheKey = `enriched:${fund.schemeCode}`;
  const hit = cacheGet(cacheKey);
  if (hit !== null) return hit;

  try {
    const details = await cachedFetch(`details:full:${fund.schemeCode}`, `/mf/${fund.schemeCode}`, {}, TTL.FUND_DETAILS);
    const navData = Array.isArray(details?.data) ? details.data : [];
    const returns = calculateRealReturns(navData);
    
    // Generate a mini-chart (last 30 days) to make it look premium
    const chartData = navData.slice(0, 30).reverse().map(n => parseFloat(n.nav));

    const enriched = {
      ...fund,
      nav: returns.currentNav,
      returns1Y: returns.returns1Y,
      returns3Y: returns.returns3Y,
      returns5Y: returns.returns5Y,
      chartData
    };
    cacheSet(cacheKey, enriched, TTL.CLASSIFY);
    return enriched;
  } catch (err) {
    // Graceful fallback
    return { ...fund, nav: 0, returns1Y: 0, returns3Y: 0, returns5Y: 0, chartData: [] };
  }
};

export const getTrendingFunds = async (req, res) => {
  try {
    // Select top 5 popular funds randomly to simulate "trending" but with real data
    const shuffled = [...CURATED_FUNDS].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 5);
    
    const enrichedFunds = await Promise.all(selected.map(enrichCuratedFund));
    res.json(enrichedFunds);
  } catch (error) {
    res.status(500).json({ message: "Unable to load trending funds.", error: error.message });
  }
};

export const getTopPerformingFunds = async (req, res) => {
  try {
    // Fetch all curated funds, calculate returns, and sort by 3Y returns
    const enrichedFunds = await Promise.all(CURATED_FUNDS.map(enrichCuratedFund));
    const sorted = enrichedFunds.sort((a, b) => (b.returns3Y || 0) - (a.returns3Y || 0)).slice(0, 5);
    res.json(sorted);
  } catch (error) {
    res.status(500).json({ message: "Unable to load top performing funds.", error: error.message });
  }
};

export const getFundCategories = async (req, res) => {
  // Official SEBI Categories
  const categories = [
    { name: "Large Cap", description: "Top 100 companies by market cap", count: 120 },
    { name: "Mid Cap", description: "Companies ranked 101-250", count: 85 },
    { name: "Small Cap", description: "Companies ranked 251 onwards", count: 64 },
    { name: "Flexi Cap", description: "Invests across all market caps", count: 90 },
    { name: "ELSS", description: "Tax saving mutual funds", count: 45 },
    { name: "Debt", description: "Invests in fixed income securities", count: 210 },
    { name: "Hybrid", description: "Mix of equity and debt", count: 150 },
    { name: "Index Funds", description: "Replicates a market index", count: 70 }
  ];
  res.json(categories);
};

export const getRecommendedFunds = async (req, res) => {
  try {
    // Filter for a specific profile (e.g. Moderate risk, long term)
    const selected = CURATED_FUNDS.filter(f => f.category === "Flexi Cap" || f.category === "Large Cap");
    const enrichedFunds = await Promise.all(selected.map(enrichCuratedFund));
    
    res.json({
      reasoning: "Based on your moderate risk profile and long-term investment horizon, we recommend diversified funds that balance growth and stability.",
      funds: enrichedFunds.slice(0, 3)
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to load recommendations.", error: error.message });
  }
};

