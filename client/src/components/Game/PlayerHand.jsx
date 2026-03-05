import socket from '../../socket.js';
import useStore from '../../store.js';

export default function PlayerHand() {
  const myPlayerId = useStore(s => s.myPlayerId);
  const myTiles    = useStore(s => s.myTiles);
  const gameState  = useStore(s => s.gameState);
  const roomCode   = useStore(s => s.roomCode);

  if (!gameState) return null;

  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const isMyTurn     = activePlayer?.id === myPlayerId;
  const isPlacePhase = gameState.turnPhase === 'PLACE_TILE';

  // A tile is legal to place if its cell is empty (server performs the authoritative check)
  function isLegal(tileId) {
    return gameState.board[tileId] === 'empty';
  }

  function handlePlaceTile(tileId) {
    if (!isMyTurn || !isPlacePhase || !isLegal(tileId)) return;
    socket.emit('game:placeTile', { playerId: myPlayerId, roomCode, tileId });
  }

  const label = isMyTurn && isPlacePhase
    ? 'Click a tile to place it:'
    : 'Your tiles:';

  return (
    <div className="bg-slate-800/90 border-t border-slate-700 px-4 py-3 flex-shrink-0">
      <div className="flex items-center gap-2 flex-wrap">

        <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">
          {label}
        </span>

        {myTiles.length === 0 && (
          <span className="text-slate-600 text-sm italic">No tiles in hand</span>
        )}

        {myTiles.map(tileId => {
          const legal    = isLegal(tileId);
          const canPlace = isMyTurn && isPlacePhase && legal;
          const illegal  = isMyTurn && isPlacePhase && !legal;

          return (
            <button
              key={tileId}
              onClick={() => handlePlaceTile(tileId)}
              disabled={!canPlace}
              title={illegal ? `${tileId} — cannot be played right now` : tileId}
              className={`
                px-3 py-2 rounded-lg font-mono font-bold text-sm border-2 transition-all
                ${canPlace
                  ? 'bg-indigo-600 border-indigo-400 text-white hover:bg-indigo-500 cursor-pointer active:scale-95'
                  : illegal
                    ? 'bg-slate-800 border-slate-700 text-slate-600 cursor-not-allowed opacity-40'
                    : 'bg-slate-700 border-slate-600 text-slate-300 cursor-default'
                }
              `}
            >
              {tileId}
            </button>
          );
        })}

      </div>
    </div>
  );
}
