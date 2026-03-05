// The board is 12 columns (A–L) × 9 rows (1–9) = 108 tiles total.
// Tile IDs are formatted as column + row: "A1", "B3", "L9", etc.
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const ROWS    = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Generate all 108 tile IDs in board order (A1, A2 ... L9). */
export function generateAllTiles() {
  const tiles = [];
  for (const col of COLUMNS) {
    for (const row of ROWS) {
      tiles.push(`${col}${row}`);
    }
  }
  return tiles; // 108 entries
}

/**
 * Fisher-Yates shuffle — the standard unbiased shuffle algorithm.
 * Returns a NEW shuffled array; does not mutate the original.
 */
export function shuffleTiles(tiles) {
  const arr = [...tiles];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Draw `count` tiles from the front of the draw pile.
 * MUTATES the drawPile array (removes the drawn tiles).
 * Returns the drawn tiles (may be fewer than count if pile runs low).
 */
export function drawTiles(drawPile, count) {
  return drawPile.splice(0, Math.min(count, drawPile.length));
}
