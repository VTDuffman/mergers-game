import BoardCell from './BoardCell.jsx';
import socket from '../../../socket.js';
import useStore from '../../../store.js';

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const ROWS    = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function GameBoard() {
  const gameState  = useStore(s => s.gameState);
  const myTiles    = useStore(s => s.myTiles);
  const myPlayerId = useStore(s => s.myPlayerId);
  const roomCode   = useStore(s => s.roomCode);

  if (!gameState) return null;

  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const isMyTurn     = activePlayer?.id === myPlayerId;
  const isPlacePhase = gameState.turnPhase === 'PLACE_TILE';

  // Build Sets for O(1) lookups in the render loop below
  const myTileSet   = new Set(myTiles);

  // A tile is legal if the cell is currently empty.
  // Phase 3 will add chain-founding checks; Phase 4 will add merger safety checks.
  // (The server performs the authoritative check — this is just for UI highlighting.)
  const legalTileSet = new Set(
    myTiles.filter(t => gameState.board[t] === 'empty')
  );

  function handleCellClick(tileId) {
    // Guard: only send if it's actually our turn and the tile is legal
    if (!isMyTurn || !isPlacePhase) return;
    if (!myTileSet.has(tileId) || !legalTileSet.has(tileId)) return;

    socket.emit('game:placeTile', { playerId: myPlayerId, roomCode, tileId });
  }

  return (
    <div className="w-full overflow-x-auto overflow-y-hidden">
    <div className="inline-block p-2 min-w-[700px]">
      {/* Column headers: A B C D ... L */}
      <div className="flex ml-7 mb-1">
        {COLUMNS.map(col => (
          <div key={col} className="w-9 mr-px text-center text-[10px] text-slate-500 font-mono">
            {col}
          </div>
        ))}
      </div>

      {/* Board rows */}
      {ROWS.map(row => (
        <div key={row} className="flex items-center mb-px">
          {/* Row header: 1 2 3 ... 9 */}
          <div className="w-7 text-right pr-1.5 text-[10px] text-slate-500 font-mono flex-shrink-0">
            {row}
          </div>

          {/* 12 cells for this row */}
          {COLUMNS.map(col => {
            const tileId = `${col}${row}`;
            return (
              <BoardCell
                key={tileId}
                tileId={tileId}
                cellState={gameState.board[tileId]}
                isInHand={myTileSet.has(tileId)}
                isLegal={legalTileSet.has(tileId)}
                isMyTurn={isMyTurn}
                isPlacePhase={isPlacePhase}
                onClick={() => handleCellClick(tileId)}
              />
            );
          })}
        </div>
      ))}
    </div>
    </div>
  );
}
