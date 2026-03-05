// Color scheme for each hotel chain.
// Exported so the ChainTable (Phase 3) can reuse the same colors.
export const CHAIN_COLORS = {
  tower:       { bg: 'bg-yellow-400',  text: 'text-yellow-900',  border: 'border-yellow-300' },
  luxor:       { bg: 'bg-orange-500',  text: 'text-white',       border: 'border-orange-400' },
  american:    { bg: 'bg-blue-500',    text: 'text-white',       border: 'border-blue-400'   },
  worldwide:   { bg: 'bg-purple-600',  text: 'text-white',       border: 'border-purple-500' },
  festival:    { bg: 'bg-green-500',   text: 'text-white',       border: 'border-green-400'  },
  imperial:    { bg: 'bg-pink-500',    text: 'text-white',       border: 'border-pink-400'   },
  continental: { bg: 'bg-red-600',     text: 'text-white',       border: 'border-red-500'    },
};

/**
 * A single cell on the game board.
 *
 * Props:
 *   tileId      — e.g. "C3"
 *   cellState   — 'empty' | 'lone' | chainName
 *   isInHand    — true if this tile is in the current player's hand
 *   isLegal     — true if this tile can legally be placed right now
 *   isMyTurn    — true if it is the current player's turn
 *   isPlacePhase — true if we are in the PLACE_TILE phase
 *   onClick     — called when the cell is clicked
 */
export default function BoardCell({
  tileId, cellState, isInHand, isLegal, isMyTurn, isPlacePhase, onClick,
}) {
  // Determine appearance based on board state + hand state
  let bgClass     = 'bg-slate-700 border-slate-600';
  let textClass   = 'text-transparent'; // invisible for empty cells
  let borderClass = 'border';
  let label       = tileId;
  let clickable   = false;

  if (cellState !== 'empty') {
    // --- Tile is placed on the board ---
    if (cellState === 'lone') {
      bgClass   = 'bg-slate-300';
      textClass = 'text-slate-600';
    } else if (CHAIN_COLORS[cellState]) {
      // Part of a named chain (Phase 3+)
      bgClass     = CHAIN_COLORS[cellState].bg;
      textClass   = CHAIN_COLORS[cellState].text;
      borderClass = `border ${CHAIN_COLORS[cellState].border}`;
    }

  } else if (isInHand) {
    // --- Tile is in this player's hand ---
    label = tileId;

    if (isMyTurn && isPlacePhase) {
      if (isLegal) {
        // Bright and clickable — player can place this tile
        bgClass     = 'bg-indigo-600';
        textClass   = 'text-white';
        borderClass = 'border border-indigo-400';
        clickable   = true;
      } else {
        // In hand but illegal — greyed out, cannot play
        bgClass   = 'bg-slate-600 opacity-40';
        textClass = 'text-slate-400';
      }
    } else {
      // In hand, but not our turn or not place phase — subtle indicator
      bgClass   = 'bg-slate-600';
      textClass = 'text-slate-400';
    }
  }

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      title={tileId}
      className={`
        w-9 h-9 mr-px rounded-sm text-[9px] font-mono font-bold
        flex items-center justify-center select-none transition-all
        ${bgClass} ${textClass} ${borderClass}
        ${clickable ? 'cursor-pointer hover:brightness-125 hover:scale-105' : 'cursor-default'}
      `}
    >
      {cellState !== 'empty' || isInHand ? label : ''}
    </button>
  );
}
