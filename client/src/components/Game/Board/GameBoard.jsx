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
    // Outer wrapper: fills the center column and caps width on very wide desktops.
    // overflow-x-auto lets it scroll horizontally only on screens narrower than ~320px.
    <div className="w-full max-w-4xl mx-auto p-2 overflow-x-auto">

      {/*
        Single flat CSS grid with 13 columns: 1 narrow label column + 12 equal cell columns.
        All children (corner spacer, column headers, row labels, cells) are direct grid items,
        so CSS auto-placement keeps everything perfectly aligned without any fixed pixel widths.
        gap-0.5 / sm:gap-1 keeps spacing proportional as the board scales.
      */}
      <div className="grid grid-cols-[1.5rem_repeat(12,1fr)] gap-0.5 sm:gap-1">

        {/* Top-left corner spacer (aligns with the row-label column) */}
        <div />

        {/* Column headers: A B C D ... L */}
        {COLUMNS.map(col => (
          <div
            key={`h-${col}`}
            className="text-center text-[clamp(0.4rem,1.2vw,0.65rem)] text-slate-500 font-mono pb-0.5"
          >
            {col}
          </div>
        ))}

        {/*
          All 9 rows flattened into the grid.
          Each row contributes 1 label div + 12 BoardCell divs = 13 items,
          which fills exactly one row of the 13-column grid.
        */}
        {ROWS.flatMap(row => [
          // Row label (e.g. "1", "2" … "9")
          <div
            key={`label-${row}`}
            className="text-[clamp(0.4rem,1.2vw,0.65rem)] text-slate-500 font-mono flex items-center justify-end pr-0.5"
          >
            {row}
          </div>,

          // 12 cells for this row
          ...COLUMNS.map(col => {
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
          }),
        ])}

      </div>
    </div>
  );
}
