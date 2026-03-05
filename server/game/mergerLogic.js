import { getAdjacentCells } from './boardLogic.js';
import { getStockPrice } from './stockLogic.js';

// ─── Board helpers ─────────────────────────────────────────────────────────

/** Convert all board cells of `defunctChain` to `survivorChain`. Returns count. */
function absorbChainTiles(board, defunctChain, survivorChain) {
  let count = 0;
  for (const tileId of Object.keys(board)) {
    if (board[tileId] === defunctChain) { board[tileId] = survivorChain; count++; }
  }
  return count;
}

/**
 * BFS from `startTileId`, absorbing all adjacent 'lone' tiles into `survivorChain`.
 * The start tile must already be marked survivorChain before calling.
 * Returns the number of lone tiles absorbed.
 */
function absorbAdjacentLone(board, startTileId, survivorChain) {
  const queue   = [startTileId];
  const visited = new Set([startTileId]);
  let count = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of getAdjacentCells(current)) {
      if (!visited.has(neighbor) && board[neighbor] === 'lone') {
        visited.add(neighbor);
        board[neighbor] = survivorChain;
        count++;
        queue.push(neighbor);
      }
    }
  }
  return count;
}

/** Round `n` up to the nearest $100. */
function roundUp100(n) { return Math.ceil(n / 100) * 100; }

// ─── Bonus calculation ─────────────────────────────────────────────────────

/**
 * Pay majority/minority bonuses for a defunct chain.
 *
 * Rules:
 *   - Majority bonus  = 10× per-share price
 *   - Minority bonus  =  5× per-share price
 *   - Tie for majority → split (majority + minority) equally, rounded up to $100
 *   - Tie for minority → split minority bonus equally, rounded up to $100
 *   - Only 1 holder   → receives both bonuses
 *   - 2-player game   → bank holds 0–25 random shares; bonuses paid to bank disappear
 *
 * @returns {string[]} Log messages describing the payouts.
 */
export function computeAndPayBonuses(gameState, defunctChain, { skipBankRule = false } = {}) {
  const { chains, players } = gameState;
  const price         = getStockPrice(defunctChain, chains[defunctChain].size);
  const majorityBonus = price * 10;
  const minorityBonus = price * 5;

  const contestants = players.map(p => ({
    id: p.id, name: p.name,
    shares: p.stocks[defunctChain] ?? 0,
    isBank: false,
  }));

  // 2-player bank rule: bank competes with 0–25 random shares.
  // Skipped during end-game payouts — the bank only competes during live mergers.
  if (!skipBankRule && players.length === 2) {
    contestants.push({
      id: 'bank', name: 'Bank',
      shares: Math.floor(Math.random() * 26),
      isBank: true,
    });
  }

  const holders = contestants
    .filter(c => c.shares > 0)
    .sort((a, b) => b.shares - a.shares);

  const logs = [];
  if (holders.length === 0) {
    logs.push(`No one holds ${defunctChain} stock — no bonuses paid.`);
    return logs;
  }

  function pay(contestant, amount) {
    if (contestant.isBank) return; // bonus paid to bank disappears
    const p = players.find(p => p.id === contestant.id);
    if (p) p.cash += amount;
  }

  function splitAmong(pool, group, label) {
    if (group.length === 0) return;
    const each = roundUp100(pool / group.length);
    for (const c of group) {
      pay(c, each);
      if (!c.isBank) logs.push(`${c.name} earns $${each.toLocaleString()} ${label} bonus (${defunctChain}).`);
    }
  }

  const topShares = holders[0].shares;
  const majority  = holders.filter(c => c.shares === topShares);

  if (holders.length === 1 || majority.length > 1) {
    // Single holder gets both; or tied majority split both
    splitAmong(majorityBonus + minorityBonus, majority, 'majority+minority');
  } else {
    splitAmong(majorityBonus, majority, 'majority');
    // Find all tied for 2nd place
    const secondShares = holders.find(c => c.shares < topShares)?.shares;
    if (secondShares !== undefined) {
      splitAmong(minorityBonus, holders.filter(c => c.shares === secondShares), 'minority');
    }
  }

  return logs;
}

// ─── Decision queue ────────────────────────────────────────────────────────

/**
 * Return ordered list of player IDs who hold defunct shares.
 * Order: clockwise from player after the merger trigger; merger player goes last.
 */
function buildDecisionQueue(gameState, defunctChain) {
  const { players, mergerContext } = gameState;
  const n       = players.length;
  const ordered = [];
  for (let i = 1; i < n; i++) ordered.push(players[(mergerContext.mergingPlayerIndex + i) % n]);
  ordered.push(players[mergerContext.mergingPlayerIndex]);
  return ordered
    .filter(p => !p.isRetired && (p.stocks[defunctChain] ?? 0) > 0)
    .map(p => p.id);
}

// ─── Merger lifecycle ──────────────────────────────────────────────────────

/** Absorb current defunct's board tiles into the survivor and zero out its chain record. */
function finalizeDefunct(gameState) {
  const { board, chains, mergerContext } = gameState;
  const { currentDefunct: defunct, survivorChain: survivor } = mergerContext;
  const count = absorbChainTiles(board, defunct, survivor);
  chains[survivor].size  += count;
  chains[survivor].isSafe = chains[survivor].size >= 11;
  chains[defunct].size     = 0;
  chains[defunct].isActive = false;
  chains[defunct].isSafe   = false;
  mergerContext.currentDefunct = null;
}

/** Place the trigger tile and absorb any adjacent lone tiles. Called once all defuncts are done. */
function finalizeTrigger(gameState) {
  const { board, chains, mergerContext } = gameState;
  const { triggerTileId, survivorChain } = mergerContext;
  board[triggerTileId] = survivorChain;
  const lonesAbsorbed = absorbAdjacentLone(board, triggerTileId, survivorChain);
  chains[survivorChain].size += 1 + lonesAbsorbed;
  chains[survivorChain].isSafe = chains[survivorChain].size >= 11;
}

/**
 * Shift the next defunct off the queue, pay its bonuses, build its decision queue.
 * Returns { defunctChain, bonusLogs }.
 */
function startNextDefunct(gameState) {
  const { mergerContext } = gameState;
  const defunctChain = mergerContext.defunctQueue.shift();
  mergerContext.currentDefunct = defunctChain;
  const bonusLogs = computeAndPayBonuses(gameState, defunctChain);
  mergerContext.pendingDecisions = buildDecisionQueue(gameState, defunctChain);
  return { defunctChain, bonusLogs };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Initiate a merger when a tile placement touches 2+ chains.
 * The trigger tile must already be marked 'lone' on the board.
 *
 * @param {object}   gameState
 * @param {string}   triggerTileId        Tile just placed (currently 'lone')
 * @param {string[]} adjacentChains       All chains the tile touches
 * @param {number}   mergingPlayerIndex   Index of the player who triggered the merger
 * @returns {{ needsSurvivorChoice: boolean, candidateChains: string[] }}
 */
export function initiateMerger(gameState, triggerTileId, adjacentChains, mergingPlayerIndex) {
  const { chains } = gameState;
  const sorted  = [...adjacentChains].sort((a, b) => chains[b].size - chains[a].size);
  const maxSize = chains[sorted[0]].size;
  const largest = sorted.filter(n => chains[n].size === maxSize);

  gameState.mergerContext = {
    triggerTileId,
    mergingPlayerIndex,
    survivorChain:     null,
    allAdjacentChains: adjacentChains,
    defunctQueue:      [],
    currentDefunct:    null,
    pendingDecisions:  [],
    candidateChains:   largest.length > 1 ? largest : [],
  };

  if (largest.length > 1) {
    // Tie — active player must choose the survivor
    return { needsSurvivorChoice: true, candidateChains: largest };
  }

  // No tie — wire up survivor and defunct queue (sorted largest → smallest)
  gameState.mergerContext.survivorChain = sorted[0];
  gameState.mergerContext.defunctQueue  = sorted.slice(1);
  return { needsSurvivorChoice: false, candidateChains: [] };
}

/**
 * Called after the merging player picks a survivor (CHOOSE_SURVIVOR phase).
 * Finalizes the survivor/defunct queue and delegates to advanceMerger.
 */
export function applySurvivorChoice(gameState, survivorChain) {
  const { chains, mergerContext } = gameState;
  mergerContext.survivorChain = survivorChain;
  mergerContext.defunctQueue  = mergerContext.allAdjacentChains
    .filter(n => n !== survivorChain)
    .sort((a, b) => chains[b].size - chains[a].size);
  return advanceMerger(gameState);
}

/**
 * Advance the merger state machine.
 *
 * - Finalizes the current defunct chain (if any).
 * - Starts the next defunct: pays bonuses, builds decision queue.
 * - Auto-advances if no player holds shares for the current defunct.
 * - Once all defuncts are done, places the trigger tile and clears mergerContext.
 *
 * @param {object}   gameState
 * @param {string[]} [accLogs=[]]  Accumulated log lines (used internally for recursion)
 * @returns {{ phase: 'MERGER_DECISIONS'|'BUY_STOCKS', bonusLogs: string[], defunctChain: string|null }}
 */
export function advanceMerger(gameState, accLogs = []) {
  const { mergerContext } = gameState;

  // Finalize the just-completed defunct chain (if any)
  if (mergerContext.currentDefunct) finalizeDefunct(gameState);

  if (mergerContext.defunctQueue.length > 0) {
    const { defunctChain, bonusLogs } = startNextDefunct(gameState);
    accLogs.push(...bonusLogs);
    if (mergerContext.pendingDecisions.length > 0) {
      return { phase: 'MERGER_DECISIONS', bonusLogs: accLogs, defunctChain };
    }
    // No one holds shares for this defunct — skip directly to the next
    return advanceMerger(gameState, accLogs);
  }

  // All defuncts resolved — place the trigger tile and wrap up
  finalizeTrigger(gameState);
  gameState.mergerContext = null;
  return { phase: 'BUY_STOCKS', bonusLogs: accLogs, defunctChain: null };
}

/**
 * Execute the full end-game payout sequence for all currently active chains.
 *
 * Steps (in order, matching official Acquire rules):
 *   1. Pay majority/minority shareholder bonuses for every active chain.
 *      Chains are processed largest-first.  The 2-player bank rule is NOT applied
 *      here — it only applies during live mergers.
 *   2. Liquidate every player's remaining stock holdings at current market price.
 *   3. Identify the winner (highest cash; ties go to the first player in seat order).
 *
 * Mutates player.cash and player.stocks directly.
 *
 * @param {object} gameState
 * @returns {{ logs: string[], winnerId: string }}
 */
export function executeEndGamePayouts(gameState) {
  const { chains, players } = gameState;
  const logs = [];

  // Collect active chains, sorted largest-first for logical log ordering
  const activeChains = Object.entries(chains)
    .filter(([, c]) => c.isActive)
    .sort(([, a], [, b]) => b.size - a.size)
    .map(([name]) => name);

  // ── Step 1: Bonuses ──────────────────────────────────────────────────────
  if (activeChains.length === 0) {
    logs.push('No active chains — no shareholder bonuses to pay.');
  } else {
    logs.push('=== FINAL SHAREHOLDER BONUSES ===');
    for (const chainName of activeChains) {
      const size = chains[chainName].size;
      const price = getStockPrice(chainName, size);
      logs.push(`${chainName} (${size} tiles, $${price.toLocaleString()}/share):`);
      const bonusLogs = computeAndPayBonuses(gameState, chainName, { skipBankRule: true });
      logs.push(...bonusLogs);
    }
  }

  // ── Step 2: Liquidation ──────────────────────────────────────────────────
  logs.push('=== STOCK LIQUIDATION ===');
  for (const player of players) {
    let liquidationTotal = 0;

    for (const chainName of activeChains) {
      const qty = player.stocks[chainName] ?? 0;
      if (qty === 0) continue;

      const price = getStockPrice(chainName, chains[chainName].size);
      const value = qty * price;
      player.cash               += value;
      player.stocks[chainName]   = 0; // shares returned to bank (cosmetic — game is over)
      liquidationTotal          += value;
      logs.push(`${player.name} sells ${qty}× ${chainName} @ $${price.toLocaleString()} = $${value.toLocaleString()}.`);
    }

    if (liquidationTotal > 0) {
      logs.push(`${player.name} total from stock: $${liquidationTotal.toLocaleString()} → cash now $${player.cash.toLocaleString()}.`);
    }
  }

  // ── Step 3: Final standings & winner ────────────────────────────────────
  logs.push('=== FINAL STANDINGS ===');
  const ranked = [...players].sort((a, b) => b.cash - a.cash);
  for (let i = 0; i < ranked.length; i++) {
    logs.push(`#${i + 1} ${ranked[i].name}: $${ranked[i].cash.toLocaleString()}`);
  }

  const winner = ranked[0];
  logs.push(`${winner.name} wins with $${winner.cash.toLocaleString()}!`);

  return { logs, winnerId: winner.id };
}

/**
 * Validate a player's merger decision (sell/trade/keep defunct stock).
 * The player must be first in pendingDecisions.
 *
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMergerDecision(gameState, playerId, { sell = 0, trade = 0 }) {
  const { mergerContext, players, stockBank } = gameState;
  if (!mergerContext || mergerContext.pendingDecisions[0] !== playerId) {
    return { valid: false, error: "It's not your turn to decide." };
  }
  const player   = players.find(p => p.id === playerId);
  const defunct  = mergerContext.currentDefunct;
  const survivor = mergerContext.survivorChain;
  const owned    = player.stocks[defunct] ?? 0;

  if (sell < 0 || trade < 0)          return { valid: false, error: 'Quantities must be non-negative.' };
  if (sell + trade > owned)            return { valid: false, error: `You only own ${owned} ${defunct} shares.` };
  if (trade % 2 !== 0)                 return { valid: false, error: 'Trade must be an even number (2 defunct = 1 survivor).' };
  if (stockBank[survivor] < trade / 2) return { valid: false, error: `Not enough ${survivor} shares in the bank to trade.` };
  return { valid: true };
}

/**
 * Apply a player's merger decision: sell some shares, trade some 2-for-1, keep the rest.
 * Removes the player from pendingDecisions.
 */
export function applyMergerDecision(gameState, playerId, { sell = 0, trade = 0 }) {
  const { mergerContext, chains, players, stockBank } = gameState;
  const player   = players.find(p => p.id === playerId);
  const defunct  = mergerContext.currentDefunct;
  const survivor = mergerContext.survivorChain;
  const price    = getStockPrice(defunct, chains[defunct].size);

  if (sell > 0) {
    player.stocks[defunct] -= sell;
    stockBank[defunct]     += sell;
    player.cash            += sell * price;
  }
  if (trade > 0) {
    player.stocks[defunct]  -= trade;
    stockBank[defunct]      += trade;
    player.stocks[survivor] += trade / 2;
    stockBank[survivor]     -= trade / 2;
  }

  mergerContext.pendingDecisions = mergerContext.pendingDecisions.filter(id => id !== playerId);
}
