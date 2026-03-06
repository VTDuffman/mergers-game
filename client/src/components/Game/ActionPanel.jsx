import socket from '../../socket.js';
import useStore from '../../store.js';

/**
 * ActionPanel
 *
 * Renders the Undo Turn button when available. This component is placed
 * inside the right sidebar (GameLayout), directly above StockPanel, so
 * the Undo and End Turn buttons always appear as a cohesive pair.
 *
 * Renders nothing when undo is not available or it is not the player's turn.
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
    <button
      onClick={handleUndo}
      className="w-full px-3 py-2 rounded-lg font-semibold text-sm border-2 flex-shrink-0
                 bg-orange-900/60 border-orange-600 text-orange-300
                 sm:hover:bg-orange-800 sm:hover:text-orange-100 active:scale-95
                 touch-manipulation transition-all cursor-pointer"
      title="Take back your tile placement and replay your turn"
    >
      ↩ Undo Turn
    </button>
  );
}
