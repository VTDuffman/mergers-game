import { getAdjacentCells } from './boardLogic.js';

/**
 * BFS flood-fill: starting from `startTileId`, find all 'lone' tiles
 * that are connected to it through adjacency.
 *
 * The start tile must already be marked 'lone' on the board before calling this.
 * Returns an array of every tile ID in the connected lone-tile group.
 *
 * Example: if A3, A4, A5 are all lone and you call findConnectedLoneTiles(board, 'A4'),
 * you get back ['A4', 'A3', 'A5'] (all three, regardless of which you started from).
 */
function findConnectedLoneTiles(board, startTileId) {
  const visited = new Set([startTileId]);
  const queue   = [startTileId];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of getAdjacentCells(current)) {
      if (!visited.has(neighbor) && board[neighbor] === 'lone') {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return [...visited];
}

/**
 * Found a brand-new hotel chain.
 *
 * Called after a tile placement whose classifyPlacement() returned 'found'
 * and the player has chosen a chain name.
 *
 * Flood-fills all lone tiles connected to the founding tile, marks them
 * all as `chainName`, then updates the chain's size, isActive, and isSafe.
 *
 * @param {object} gameState       - full server-side game state
 * @param {string} foundingTileId  - the tile that was placed (already 'lone' on board)
 * @param {string} chainName       - the hotel chain name the player chose
 * @returns {number}               - total number of tiles in the new chain
 */
export function foundChain(gameState, foundingTileId, chainName) {
  const { board, chains } = gameState;

  const tiles = findConnectedLoneTiles(board, foundingTileId);

  for (const tileId of tiles) {
    board[tileId] = chainName;
  }

  chains[chainName].size     = tiles.length;
  chains[chainName].isActive = true;
  chains[chainName].isSafe   = tiles.length >= 11; // technically possible, though rare

  return tiles.length;
}

/**
 * Grow an existing hotel chain by absorbing the newly placed tile and
 * any lone tiles that are now connected to it.
 *
 * Called after a tile placement whose classifyPlacement() returned 'grow'.
 * The new tile is already marked 'lone' on the board; this function
 * reassigns it (and any adjacent connected lone tiles) to the chain.
 *
 * @param {object} gameState  - full server-side game state
 * @param {string} newTileId  - the tile just placed (currently 'lone' on board)
 * @param {string} chainName  - the chain being extended
 * @returns {number}          - number of tiles added to the chain
 */
export function growChain(gameState, newTileId, chainName) {
  const { board, chains } = gameState;

  // Flood-fill: newTileId + any lone tiles now connected through it
  const newTiles = findConnectedLoneTiles(board, newTileId);

  for (const tileId of newTiles) {
    board[tileId] = chainName;
  }

  chains[chainName].size  += newTiles.length;
  chains[chainName].isSafe = chains[chainName].size >= 11;

  return newTiles.length;
}
