// ---- Chain metadata ----

// The canonical display order (cheapest → priciest, matching the rulebook table)
export const CHAIN_ORDER = [
  'tower', 'luxor', 'american', 'worldwide', 'festival', 'imperial', 'continental',
];

// Human-readable names for display
export const CHAIN_LABELS = {
  tower:       'Tower',
  luxor:       'Luxor',
  american:    'American',
  worldwide:   'Worldwide',
  festival:    'Festival',
  imperial:    'Imperial',
  continental: 'Continental',
};

// ---- Price chart ----
// Mirrors the server's stockLogic.js — both must stay in sync with the rulebook.

// Tier 0: Tower, Luxor  (cheapest)
// Tier 1: American, Worldwide, Festival  (mid)
// Tier 2: Imperial, Continental  (priciest)
const CHAIN_TIER = {
  tower: 0,       luxor: 0,
  american: 1,    worldwide: 1,  festival: 1,
  imperial: 2,    continental: 2,
};

// [minimum_chain_size, [tier0_price, tier1_price, tier2_price]]
// Checked largest-to-smallest so the first match wins.
const PRICE_BREAKPOINTS = [
  [41, [1000, 1100, 1200]],
  [31, [ 900, 1000, 1100]],
  [21, [ 800,  900, 1000]],
  [11, [ 700,  800,  900]],
  [6,  [ 600,  700,  800]],
  [5,  [ 500,  600,  700]],
  [4,  [ 400,  500,  600]],
  [3,  [ 300,  400,  500]],
  [2,  [ 200,  300,  400]],
];

/**
 * Return the stock price for a chain of the given size.
 * Returns 0 if the chain has fewer than 2 tiles (not yet active).
 */
export function getStockPrice(chainName, size) {
  if (size < 2) return 0;
  const tier = CHAIN_TIER[chainName] ?? 0;
  for (const [minSize, prices] of PRICE_BREAKPOINTS) {
    if (size >= minSize) return prices[tier];
  }
  return 0;
}

/** Format a dollar amount with commas: 6000 → "$6,000" */
export function formatDollars(n) {
  return '$' + n.toLocaleString();
}
