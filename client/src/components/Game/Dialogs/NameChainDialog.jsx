import socket from '../../../socket.js';
import useStore from '../../../store.js';
import { CHAIN_COLORS } from '../Board/BoardCell.jsx';
import { CHAIN_ORDER, CHAIN_LABELS } from '../../../utils/gameConstants.js';

export default function NameChainDialog() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);
  const roomCode   = useStore(s => s.roomCode);

  // Only render when the game is waiting for a chain name
  if (!gameState || gameState.turnPhase !== 'NAME_CHAIN') return null;

  const activePlayer    = gameState.players[gameState.activePlayerIndex];
  const isMyTurn        = activePlayer?.id === myPlayerId;
  const availableChains = CHAIN_ORDER.filter(name => !gameState.chains[name].isActive);

  function handleSelect(chainName) {
    socket.emit('game:nameChain', { playerId: myPlayerId, roomCode, chainName });
  }

  return (
    // Full-screen semi-transparent overlay — blocks interaction with the board
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-600">

        <h2 className="text-xl font-bold mb-1">New Hotel Chain!</h2>

        <p className="text-slate-400 text-sm mb-5">
          {isMyTurn
            ? 'Your tile connected two or more hotels. Choose which chain they will become:'
            : `${activePlayer?.name} is naming the new hotel chain…`}
        </p>

        {isMyTurn ? (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              {availableChains.map(chainName => {
                const color = CHAIN_COLORS[chainName];
                return (
                  <button
                    key={chainName}
                    onClick={() => handleSelect(chainName)}
                    className={`
                      py-3 px-4 rounded-xl font-bold text-sm transition-all
                      hover:scale-105 active:scale-95 shadow-md
                      ${color.bg} ${color.text}
                    `}
                  >
                    {CHAIN_LABELS[chainName]}
                  </button>
                );
              })}
            </div>

            <p className="mt-4 text-center text-xs text-slate-500">
              You'll receive 1 free share in whichever chain you choose.
            </p>
          </>
        ) : (
          // Other players see a waiting spinner
          <div className="flex items-center justify-center gap-3 py-4">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-400 border-t-transparent" />
            <span className="text-slate-400 text-sm">Waiting for {activePlayer?.name}…</span>
          </div>
        )}
      </div>
    </div>
  );
}
