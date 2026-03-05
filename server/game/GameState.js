import { generateAllTiles, shuffleTiles, drawTiles } from './tileLogic.js';

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const ROWS    = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// The seven hotel chains, grouped by price tier.
// Tier 1 (cheapest): tower, luxor
// Tier 2 (mid):      american, worldwide, festival
// Tier 3 (priciest): imperial, continental
export const CHAIN_NAMES = [
  'tower', 'luxor', 'american', 'worldwide', 'festival', 'imperial', 'continental',
];

/**
 * Create a fresh game state for a new game.
 *
 * @param {Array} players — array of { id, name } objects from the room
 * @returns {{ gameState, playerTiles }}
 *   gameState   — the full server-side state (including private draw pile)
 *   playerTiles — Map of playerId → their private tile hand (6 tiles each)
 */
export function createInitialGameState(players) {
  // Shuffle all 108 tiles
  const shuffled = shuffleTiles(generateAllTiles());

  // Deal 6 tiles to each player (private — stored separately, never in the broadcast)
  const playerTiles = {};
  for (const player of players) {
    playerTiles[player.id] = drawTiles(shuffled, 6);
  }

  // Build the board: every cell starts as 'empty'
  // board[tileId] will be: 'empty' | 'lone' | chainName
  const board = {};
  for (const col of COLUMNS) {
    for (const row of ROWS) {
      board[`${col}${row}`] = 'empty';
    }
  }

  const gameState = {
    // ---- Turn tracking ----
    activePlayerIndex: 0,     // index into the players array below
    turnNumber: 1,
    // 'PLACE_TILE'         → active player must place a tile
    // 'NAME_CHAIN'         → active player picks a chain name  (Phase 3)
    // 'MERGER_DECISIONS'   → collecting sell/trade/keep choices  (Phase 4)
    // 'BUY_STOCKS'         → active player may buy up to 3 stocks
    turnPhase: 'PLACE_TILE',

    // ---- Board ----
    board, // { "A1": "empty" | "lone" | chainName, ... }

    // ---- Hotel chains ----
    // size: number of tiles in the chain
    // isActive: true once the chain has been founded on the board
    // isSafe: true once size reaches 11 (cannot be merged)
    chains: Object.fromEntries(
      CHAIN_NAMES.map(name => [name, { size: 0, isActive: false, isSafe: false }])
    ),

    // ---- Stock bank ----
    // Each chain starts with 25 shares available to buy
    stockBank: Object.fromEntries(CHAIN_NAMES.map(name => [name, 25])),

    // ---- Players (public info only — tiles are in playerTiles, not here) ----
    players: players.map(p => ({
      id: p.id,
      name: p.name,
      cash: 6000,
      stocks: Object.fromEntries(CHAIN_NAMES.map(name => [name, 0])),
      isRetired: false,
    })),

    // ---- Chain naming (NAME_CHAIN phase) ----
    // When a tile placement founds a new chain, the founding tile's ID is stored
    // here so game:nameChain knows where to flood-fill from.
    pendingFoundTileId: null,

    // ---- Merger context (CHOOSE_SURVIVOR / MERGER_DECISIONS phases) ----
    // Populated by mergerLogic.initiateMerger; cleared when the merger resolves.
    // null when no merger is in progress.
    mergerContext: null,

    // ---- Draw pile (SERVER ONLY — never sent to clients) ----
    drawPile: shuffled, // whatever tiles remain after dealing

    // ---- Retired tile positions ----
    // When a player retires, their tile positions are permanently blocked.
    retiredTilePositions: [],

    // ---- Game log ----
    log: [], // [{ time, message }, ...]

    // ---- End state ----
    winner: null, // playerId of the winner once game ends

    // ---- End-game availability ----
    // Set to true when any end-game condition is first detected after a tile placement.
    // The active player may then choose to declare the game over (or keep playing).
    endGameAvailable: false,
    endGameReason: null,   // human-readable string describing why the game can end
    isGameOver: false,     // set to true when a player officially declares the game over
  };

  return { gameState, playerTiles };
}

/**
 * Reset an in-progress or finished game to a fresh state, keeping the same players.
 *
 * Preserves each player's `id` and `name`. Everything else (cash, stocks, isRetired,
 * board, chains, draw pile, log) is regenerated from scratch exactly like a new game.
 *
 * @param {object} oldState — the current gameState (used only for the player list)
 * @returns {{ newGameState, newPlayerTiles }}
 */
export function resetGameState(oldState) {
  // Strip each player back to bare identity; createInitialGameState fills in the rest
  const players = oldState.players.map(p => ({ id: p.id, name: p.name }));
  const { gameState: newGameState, playerTiles: newPlayerTiles } = createInitialGameState(players);
  return { newGameState, newPlayerTiles };
}

/**
 * Check whether the current board state meets any end-game condition.
 *
 * Conditions (per the rules):
 *   1. Any active chain has grown to 41 or more tiles.
 *   2. All active chains are "safe" (≥ 11 tiles) AND at least one chain is active.
 *
 * Returns { canEnd: false } if no condition is met.
 * Returns { canEnd: true, reason: string } if the active player may declare game over.
 */
export function checkEndGameConditions(gs) {
  const activeChains = Object.entries(gs.chains).filter(([, chain]) => chain.isActive);

  // No chains on the board yet — game cannot end.
  if (activeChains.length === 0) return { canEnd: false };

  // Condition 1: a chain has reached 41+ tiles
  const giant = activeChains.find(([, chain]) => chain.size >= 41);
  if (giant) {
    return {
      canEnd: true,
      reason: `${giant[0]} has reached ${giant[1].size} tiles (41+ triggers end game).`,
    };
  }

  // Condition 2: every active chain is safe (≥ 11 tiles)
  const allSafe = activeChains.every(([, chain]) => chain.isSafe);
  if (allSafe) {
    return {
      canEnd: true,
      reason: `All ${activeChains.length} active chain(s) are safe (11+ tiles each).`,
    };
  }

  return { canEnd: false };
}

/**
 * Return a copy of the game state that is safe to broadcast to all players.
 * - Strips the draw pile (players must not see upcoming tiles)
 * - Adds drawPileCount so the UI can show how many tiles remain
 */
export function getPublicGameState(gameState) {
  // eslint-disable-next-line no-unused-vars
  const { drawPile, ...publicState } = gameState;
  return {
    ...publicState,
    drawPileCount: drawPile.length,
  };
}
