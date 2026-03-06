import socket from '../../socket.js';
import useStore from '../../store.js';

export default function PlayerHand() {
  const myPlayerId = useStore(s => s.myPlayerId);
  const myTiles    = useStore(s => s.myTiles);
  const gameState  = useStore(s => s.gameState);
  const roomCode   = useStore(s => s.roomCode);

  if (!gameState) return null;

  const activePlayer    = gameState.players[gameState.activePlayerIndex];
  const isMyTurn        = activePlayer?.id === myPlayerId;
  const isPlacePhase    = gameState.turnPhase === 'PLACE_TILE';
  const endGameAvailable = gameState.endGameAvailable ?? false;
  const endGameReason    = gameState.endGameReason ?? '';

  // A tile is legal to place if its cell is empty (server performs the authoritative check)
  function isLegal(tileId) {
    return gameState.board[tileId] === 'empty';
  }

  function handlePlaceTile(tileId) {
    if (!isMyTurn || !isPlacePhase || !isLegal(tileId)) return;
    socket.emit('game:placeTile', { playerId: myPlayerId, roomCode, tileId });
  }

  function handleDeclareEndGame() {
    socket.emit('game:declareEndGame', { playerId: myPlayerId, roomCode });
  }

  function handleRetire() {
    socket.emit('game:retire', { playerId: myPlayerId, roomCode });
  }

  const label = isMyTurn && isPlacePhase
    ? 'Click a tile to place it:'
    : 'Your tiles:';

  return (
    <div className="sticky bottom-0 z-10 bg-slate-900/95 backdrop-blur-sm
                    lg:static lg:bg-slate-800/90 lg:backdrop-blur-none
                    border-t border-slate-700 px-4 py-3 flex-shrink-0">

      {/* ── End Game banner — visible to ALL players when end game is available ── */}
      {endGameAvailable && (
        <div className="flex items-center gap-3 mb-2 p-2 bg-emerald-900/50 border border-emerald-600 rounded-lg">
          <span className="text-emerald-300 text-xs flex-1">
            <span className="font-bold uppercase tracking-wide">End game available</span>
            {endGameReason && <span className="ml-1 text-emerald-400">— {endGameReason}</span>}
          </span>
          {/* Only the active player can pull the trigger */}
          {isMyTurn && (
            <button
              onClick={handleDeclareEndGame}
              className="px-3 py-1.5 rounded-lg font-bold text-sm bg-emerald-600 border-2 border-emerald-400
                         text-white sm:hover:bg-emerald-500 active:scale-95 transition-all touch-manipulation cursor-pointer whitespace-nowrap"
            >
              Declare End Game
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 overflow-x-auto lg:flex-wrap">

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
                  ? 'bg-indigo-600 border-indigo-400 text-white sm:hover:bg-indigo-500 cursor-pointer active:scale-95 touch-manipulation'
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

        {/* ── Retire button — only shown to the active player during PLACE_TILE ── */}
        {isMyTurn && isPlacePhase && (
          <button
            onClick={handleRetire}
            className="ml-auto px-3 py-2 rounded-lg font-bold text-sm border-2
                       bg-red-900/60 border-red-600 text-red-300
                       sm:hover:bg-red-800 sm:hover:text-red-100 active:scale-95 transition-all touch-manipulation cursor-pointer whitespace-nowrap"
            title="Retire from the game — you keep your stocks and cash, but your tiles are removed from play"
          >
            Retire
          </button>
        )}

      </div>
    </div>
  );
}
