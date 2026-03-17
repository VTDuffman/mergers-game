// Color scheme for each hotel chain — neon Vegas palette.
// bg/text/border are Tailwind classes; glow is a custom CSS class from index.css.
// Exported so GamePage and other components can reuse the same colors.
export const CHAIN_COLORS = {
  tower:       { bg: 'bg-yellow-400',  text: 'text-black',  border: 'border-yellow-300', glow: 'neon-glow-gold'   },
  luxor:       { bg: 'bg-orange-500',  text: 'text-white',  border: 'border-orange-400', glow: 'neon-glow-orange' },
  american:    { bg: 'bg-cyan-500',    text: 'text-black',  border: 'border-cyan-400',   glow: 'neon-glow-cyan'   },
  worldwide:   { bg: 'bg-purple-500',  text: 'text-white',  border: 'border-purple-400', glow: 'neon-glow-violet' },
  festival:    { bg: 'bg-lime-500',    text: 'text-black',  border: 'border-lime-400',   glow: 'neon-glow-lime'   },
  imperial:    { bg: 'bg-pink-500',    text: 'text-white',  border: 'border-pink-400',   glow: 'neon-glow-pink'   },
  continental: { bg: 'bg-red-500',     text: 'text-white',  border: 'border-red-400',    glow: 'neon-glow-red'    },
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
  let bgClass     = 'bg-slate-800 border-slate-700'; // darker base for black background
  let textClass   = 'text-transparent';              // invisible for empty cells
  let borderClass = 'border';
  let glowClass   = '';
  let label       = tileId;
  let clickable   = false;

  if (cellState !== 'empty') {
    // --- Tile is placed on the board ---
    if (cellState === 'lone') {
      // Unaffiliated placed tile — neutral grey
      bgClass   = 'bg-slate-400';
      textClass = 'text-slate-800';
    } else if (CHAIN_COLORS[cellState]) {
      // Part of a named chain — neon color + matching glow
      bgClass     = CHAIN_COLORS[cellState].bg;
      textClass   = CHAIN_COLORS[cellState].text;
      borderClass = `border ${CHAIN_COLORS[cellState].border}`;
      glowClass   = CHAIN_COLORS[cellState].glow;
    }

  } else if (isInHand) {
    // --- Tile is in this player's hand ---
    label = tileId;

    if (isMyTurn && isPlacePhase) {
      if (isLegal) {
        // Bright and clickable — neon cyan highlight
        bgClass     = 'bg-cyan-600';
        textClass   = 'text-black';
        borderClass = 'border border-cyan-400';
        glowClass   = 'neon-glow-cyan';
        clickable   = true;
      } else {
        // In hand but illegal — greyed out, cannot play
        bgClass   = 'bg-slate-700 opacity-40';
        textClass = 'text-slate-500';
      }
    } else {
      // In hand, but not our turn or not place phase — subtle indicator
      bgClass   = 'bg-slate-700';
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
        w-full aspect-square rounded-sm text-[clamp(0.4rem,1.2vw,0.7rem)] font-mono font-bold
        flex items-center justify-center select-none transition-all
        ${bgClass} ${textClass} ${borderClass} ${glowClass}
        ${clickable ? 'cursor-pointer touch-manipulation sm:hover:brightness-125 sm:hover:scale-105' : 'cursor-default'}
      `}
    >
      {cellState !== 'empty' || isInHand ? label : ''}
    </button>
  );
}
