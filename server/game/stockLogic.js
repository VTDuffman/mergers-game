// ---- Price tiers ----
// Tier 0 (cheapest): Tower, Luxor
// Tier 1 (mid):      American, Worldwide, Festival
// Tier 2 (priciest): Imperial, Continental

export const CHAIN_TIER = {
  tower: 0,       luxor: 0,
  american: 1,    worldwide: 1,   festival: 1,
  imperial: 2,    continental: 2,
};

// Price table: [minimum_chain_size, [tier0_price, tier1_price, tier2_price]]
// Listed largest-first so we can iterate and return on the first match.
// Matches the official Acquire/Mergers price chart exactly.
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
 * Return the current stock price for a chain of the given size.
 * Returns 0 if the chain has fewer than 2 tiles (not yet founded / invalid).
 */
export function getStockPrice(chainName, size) {
  if (size < 2) return 0;
  const tier = CHAIN_TIER[chainName] ?? 0;
  for (const [minSize, prices] of PRICE_BREAKPOINTS) {
    if (size >= minSize) return prices[tier];
  }
  return 0;
}

/**
 * Validate a stock purchase order before applying it.
 *
 * purchases = [{ chainName: string, quantity: number }, ...]
 *
 * Returns { valid: true, totalCost: number }
 *      or { valid: false, error: string }
 */
export function validatePurchase(gameState, playerId, purchases) {
  // An empty purchase (player skips buying) is always valid
  if (!purchases || purchases.length === 0) return { valid: true, totalCost: 0 };

  const player = gameState.players.find(p => p.id === playerId);
  if (!player) return { valid: false, error: 'Player not found.' };

  const totalQty = purchases.reduce((sum, p) => sum + (p.quantity ?? 0), 0);
  if (totalQty > 3) {
    return { valid: false, error: 'You can only buy up to 3 stocks per turn.' };
  }

  let totalCost = 0;
  for (const { chainName, quantity } of purchases) {
    if (!quantity || quantity <= 0) continue;

    const chain = gameState.chains[chainName];
    if (!chain)          return { valid: false, error: `Unknown chain: ${chainName}.` };
    if (!chain.isActive) return { valid: false, error: `${chainName} is not yet active.` };
    if (gameState.stockBank[chainName] < quantity) {
      return { valid: false, error: `Not enough ${chainName} shares available in the bank.` };
    }

    totalCost += getStockPrice(chainName, chain.size) * quantity;
  }

  if (player.cash < totalCost) {
    return {
      valid: false,
      error: `Not enough cash — this order costs $${totalCost.toLocaleString()}.`,
    };
  }

  return { valid: true, totalCost };
}

/**
 * Apply a validated purchase to the game state.
 * Mutates player.cash, player.stocks, and gameState.stockBank in place.
 */
export function applyPurchase(gameState, playerId, purchases) {
  if (!purchases || purchases.length === 0) return;

  const player = gameState.players.find(p => p.id === playerId);
  for (const { chainName, quantity } of purchases) {
    if (!quantity || quantity <= 0) continue;
    const price = getStockPrice(chainName, gameState.chains[chainName].size);
    player.cash                    -= price * quantity;
    player.stocks[chainName]       += quantity;
    gameState.stockBank[chainName] -= quantity;
  }
}

/**
 * Calculate a player's net worth: cash + market value of all stock holdings.
 * Stock in inactive chains (not on the board) is worth $0.
 * Used in PlayerList display and end-game scoring.
 */
export function calcNetWorth(player, chains) {
  let worth = player.cash;
  for (const [chainName, qty] of Object.entries(player.stocks)) {
    if (qty > 0 && chains[chainName]?.isActive) {
      worth += qty * getStockPrice(chainName, chains[chainName].size);
    }
  }
  return worth;
}
