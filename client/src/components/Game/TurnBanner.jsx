import useStore from '../../store.js';

// Human-readable labels for each turn phase
const PHASE_LABELS = {
  PLACE_TILE:        'Place a tile',
  NAME_CHAIN:        'Name the new chain',
  CHOOSE_SURVIVOR:   'Merger — choose the survivor',
  MERGER_DECISIONS:  'Merger — players deciding',
  BUY_STOCKS:        'Buy stocks (or skip)',
  GAME_OVER:         'Game over',
};

export default function TurnBanner() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);

  if (!gameState) return null;

  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const isMyTurn     = activePlayer?.id === myPlayerId;
  const phaseLabel   = PHASE_LABELS[gameState.turnPhase] ?? gameState.turnPhase;

  return (
    <div className={`
      flex items-center gap-3 px-4 py-2 text-sm font-medium flex-shrink-0
      ${isMyTurn ? 'bg-indigo-900/70 text-indigo-100' : 'bg-slate-800 text-slate-300'}
    `}>
      {/* Animated pulse dot — only shown on your turn */}
      {isMyTurn && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-400" />
        </span>
      )}

      <span>
        {isMyTurn
          ? `Your turn — ${phaseLabel}`
          : `${activePlayer?.name}'s turn — ${phaseLabel}`}
      </span>

      {/* Right side: turn number and tiles remaining */}
      <span className="ml-auto text-xs text-slate-500">
        Turn {gameState.turnNumber} · {gameState.drawPileCount} tiles left
      </span>
    </div>
  );
}
