/**
 * Lightweight in-process TTL cache.
 *
 * Usage:
 *   import { cacheGet, cacheSet } from "../utils/cache.js";
 *   const val = cacheGet("my-key");
 *   cacheSet("my-key", value, 60 * 60 * 1000); // 1 hour
 *
 * All values live in memory and are lost on server restart.
 * That is fine — mfapi is the source of truth; the cache only
 * prevents hammering it on every request.
 */

const _store = new Map(); // key → { value, expiresAt }

/**
 * Returns the cached value for key, or null if missing / expired.
 */
export const cacheGet = (key) => {
  const entry = _store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _store.delete(key);
    return null;
  }
  return entry.value;
};

/**
 * Stores value under key with a TTL in milliseconds.
 */
export const cacheSet = (key, value, ttlMs) => {
  _store.set(key, { value, expiresAt: Date.now() + ttlMs });
};

/** Removes a specific key (e.g. after a write operation). */
export const cacheDel = (key) => _store.delete(key);

/** Clears all cached entries (useful for testing). */
export const cacheClear = () => _store.clear();

/** Returns the number of unexpired entries currently stored. */
export const cacheSize = () => {
  const now = Date.now();
  let count = 0;
  for (const entry of _store.values()) {
    if (now <= entry.expiresAt) count++;
  }
  return count;
};

// ─── TTL constants (export so controllers import them) ────────────────────────
export const TTL = {
  NAV_LATEST:   15 * 60 * 1000,    // 15 min  — NAV updates once per trading day
  FUND_DETAILS: 12 * 60 * 60 * 1000, // 12 h   — historical data only grows, never changes
  SEARCH:        1 * 60 * 60 * 1000, //  1 h   — search results are stable
  FUND_LIST:     6 * 60 * 60 * 1000, //  6 h   — scheme list rarely changes
  CLASSIFY:      6 * 60 * 60 * 1000, //  6 h   — active/inactive flag from latest NAV date
  CLASSIFY_ERR:      60 * 1000,      //  1 min  — retry failed lookups sooner
};
