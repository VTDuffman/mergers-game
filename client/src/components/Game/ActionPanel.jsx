import socket from '../../socket.js';
import useStore from '../../store.js';

/**
 * ActionPanel
 *
 * Renders contextual action buttons for the active player.
 * Currently shows only the Undo button, which lets a player take back
 * their tile placement as long as the turn hasn't been locked yet
 * (i.e. they haven't confirmed a merger).
 *
 * This component renders nothing for non-active players.
 */
export default function ActionPanel() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);
  const roomCode   = useStore(s => s.roomCode);

  if (!gameState) return null;

  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const isMyTurn     = activePlayer?.id === myPlayerId;

  // Undo is available when: it's my turn, I've already acted, and the turn isn't locked
  const canUndo = isMyTurn && gameState.hasActedThisTurn && !gameState.isTurnLocked;

  if (!canUndo) return null;

  function handleUndo() {
    socket.emit('game:undoTurn', { playerId: myPlayerId, roomCode });
  }

  return (
    <div className="sticky bottom-0 z-10 bg-slate-900/95 backdrop-blur-sm
                    lg:static lg:bg-transparent lg:backdrop-blur-none
                    px-4 py-1.5 flex-shrink-0">
      <button
        onClick={handleUndo}
        className="w-full px-3 py-2 rounded-lg font-semibold text-sm border-2
                   bg-orange-900/60 border-orange-600 text-orange-300
                   hover:bg-orange-800 hover:text-orange-100 active:scale-95
                   transition-all cursor-pointer"
        title="Take back your tile placement and replay your turn"
      >
        Undo Turn
      </button>
    </div>
  );
}
