import socket from '../../../socket.js';
import useStore from '../../../store.js';
import { CHAIN_COLORS } from '../Board/BoardCell.jsx';
import { CHAIN_LABELS } from '../../../utils/gameConstants.js';

/**
 * ConfirmMergerDialog
 *
 * Shown when a tile placement would trigger a merger (turnPhase === 'CONFIRM_MERGER').
 * Gives the active player a clear warning and the choice to either:
 *   - "Send Move"  → confirm the merger (locks the turn, cannot undo after this)
 *   - "Go Back"    → undo the tile placement and try a different tile
 *
 * Non-active players see a simple "waiting" message.
 */
export default function ConfirmMergerDialog() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);
  const roomCode   = useStore(s => s.roomCode);

  if (!gameState || gameState.turnPhase !== 'CONFIRM_MERGER') return null;

  const pm = gameState.pendingMerger;
  if (!pm) return null;

  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const isMyTurn     = activePlayer?.id === myPlayerId;

  function handleConfirm() {
    socket.emit('game:confirmMerger', { playerId: myPlayerId, roomCode });
  }

  function handleGoBack() {
    socket.emit('game:undoTurn', { playerId: myPlayerId, roomCode });
  }

  // Build human-readable chain labels with color dots
  function ChainPill({ chainName }) {
    const color = CHAIN_COLORS[chainName];
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <span className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${color.bg}`} />
        <span className="text-white">{CHAIN_LABELS[chainName]}</span>
      </span>
    );
  }

  // Compose the body text based on whether it's a tie or a clear survivor
  function BodyText() {
    if (pm.isTie) {
      // All chains are the same size — player will pick the survivor after confirming
      const chainPills = pm.defunctNames.map((name, i) => (
        <span key={name}>
          {i > 0 && <span className="text-slate-400"> and </span>}
          <ChainPill chainName={name} />
        </span>
      ));
      return (
        <p className="text-slate-300 text-sm leading-relaxed">
          This move will trigger a merger between {chainPills}.
          {' '}The chains are tied — you'll choose the survivor next.
          {' '}<span className="text-amber-400 font-medium">Once sent, this move cannot be undone.</span>
        </p>
      );
    }

    // Clear survivor: largest chain absorbs the others
    const defunctPills = pm.defunctNames.map((name, i) => (
      <span key={name}>
        {i > 0 && <span className="text-slate-400">{i === pm.defunctNames.length - 1 ? ' and ' : ', '}</span>}
        <ChainPill chainName={name} />
      </span>
    ));
    return (
      <p className="text-slate-300 text-sm leading-relaxed">
        This move will cause <ChainPill chainName={pm.survivorName} /> to acquire {defunctPills}.
        {' '}<span className="text-amber-400 font-medium">Once sent, this move cannot be undone.</span>
      </p>
    );
  }

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl p-5 max-w-sm w-full mx-4 shadow-2xl border border-slate-700">

        {isMyTurn ? (
          <>
            <h2 className="text-white font-bold text-lg mb-3">Confirm Merger</h2>
            <div className="mb-5">
              <BodyText />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleGoBack}
                className="flex-1 py-2.5 bg-slate-600 hover:bg-slate-500
                           active:scale-[0.98] rounded-xl font-semibold text-sm
                           text-white transition-all"
              >
                Go Back
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500
                           active:scale-[0.98] rounded-xl font-semibold text-sm
                           text-white transition-all"
              >
                Send Move
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-white font-bold text-lg mb-2">Merger Pending</h2>
            <p className="text-slate-400 text-sm">
              Waiting for{' '}
              <strong className="text-white">{activePlayer?.name}</strong>{' '}
              to confirm their merger move…
            </p>
          </>
        )}

      </div>
    </div>
  );
}
