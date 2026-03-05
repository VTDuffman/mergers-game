const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

/**
 * Returns the IDs of all cells adjacent to a given tile (up, down, left, right).
 * Edge and corner cells have fewer than 4 neighbors.
 *
 * Example: getAdjacentCells("C3") → ["B3", "D3", "C2", "C4"]
 */
export function getAdjacentCells(tileId) {
  const col    = tileId[0];
  const row    = parseInt(tileId.slice(1));
  const colIdx = COLUMNS.indexOf(col);
  const adj    = [];

  if (colIdx > 0)  adj.push(`${COLUMNS[colIdx - 1]}${row}`); // left
  if (colIdx < 11) adj.push(`${COLUMNS[colIdx + 1]}${row}`); // right
  if (row > 1)     adj.push(`${col}${row - 1}`);             // up
  if (row < 9)     adj.push(`${col}${row + 1}`);             // down

  return adj;
}

/**
 * Returns a list of unique chain names (e.g. ["tower", "luxor"]) found
 * in cells adjacent to the given tile. Empty cells and lone tiles are ignored.
 * Used to detect what chains a new tile would touch.
 */
export function getAdjacentChains(board, tileId) {
  const chainNames = new Set();
  for (const cellId of getAdjacentCells(tileId)) {
    const state = board[cellId];
    // board state is 'empty', 'lone', or a chain name string
    if (state !== 'empty' && state !== 'lone') {
      chainNames.add(state);
    }
  }
  return [...chainNames];
}

/**
 * Returns the IDs of adjacent cells that contain lone tiles (placed but unchained).
 * Used to detect chain founding: a new tile adjacent to lone tiles starts a chain.
 */
export function getAdjacentLoneTiles(board, tileId) {
  return getAdjacentCells(tileId).filter(id => board[id] === 'lone');
}

/**
 * Classify what placing a tile at `tileId` would do.
 *
 * Returns one of:
 *   'simple'   — no adjacent tiles; becomes a lone tile
 *   'found'    — adjacent to 1+ lone tiles (and no chains); would start a new chain
 *   'grow'     — adjacent to exactly 1 existing chain; extends that chain
 *   'merge'    — adjacent to 2+ existing chains; triggers a merger
 *   'illegal'  — cannot be played (would merge 2+ safe chains, or would start an 8th chain)
 *
 * This function is used both for legality checking and to drive turn logic in Phases 3 & 4.
 */
export function classifyPlacement(gameState, tileId) {
  const { board, chains } = gameState;

  // Can't place on an already-occupied cell
  if (board[tileId] !== 'empty') return 'illegal';

  const adjacentChains = getAdjacentChains(board, tileId);
  const adjacentLone   = getAdjacentLoneTiles(board, tileId);

  if (adjacentChains.length >= 2) {
    // Merger: illegal if 2 or more of the touching chains are safe (11+ tiles)
    const safeCount = adjacentChains.filter(name => chains[name].isSafe).length;
    if (safeCount >= 2) return 'illegal';
    return 'merge';
  }

  if (adjacentChains.length === 1) {
    return 'grow'; // extends an existing chain
  }

  if (adjacentLone.length > 0) {
    // Would found a new chain — illegal if all 7 chains are already active
    const activeCount = Object.values(chains).filter(c => c.isActive).length;
    if (activeCount >= 7) return 'illegal';
    return 'found';
  }

  return 'simple'; // isolated tile, no adjacency
}

/** Returns true if it is legal to place the given tile. */
export function isLegalPlacement(gameState, tileId) {
  return classifyPlacement(gameState, tileId) !== 'illegal';
}

/**
 * From a list of tile IDs, return those that are currently unplayable.
 * Used at end of turn to identify tiles that should be replaced from the draw pile.
 */
export function findUnplayableTiles(gameState, tiles) {
  return tiles.filter(tileId => classifyPlacement(gameState, tileId) === 'illegal');
}
