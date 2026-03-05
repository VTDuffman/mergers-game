import socket from '../../../socket.js';
import useStore from '../../../store.js';
import { CHAIN_COLORS } from '../Board/BoardCell.jsx';
import { CHAIN_LABELS } from '../../../utils/gameConstants.js';

export default function SurvivorDialog() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);
  const roomCode   = useStore(s => s.roomCode);

  if (!gameState || gameState.turnPhase !== 'CHOOSE_SURVIVOR') return null;

  const activePlayer    = gameState.players[gameState.activePlayerIndex];
  const isMyTurn        = activePlayer?.id === myPlayerId;
  const candidates      = gameState.mergerContext?.candidateChains ?? [];
  const tiedSize        = candidates[0] ? gameState.chains[candidates[0]]?.size : 0;

  function handleChoice(chainName) {
    socket.emit('game:chooseSurvivor', { playerId: myPlayerId, roomCode, survivorChain: chainName });
  }

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-slate-700">

        <h2 className="text-white font-bold text-lg mb-1">Merger — Tie!</h2>

        {isMyTurn ? (
          <>
            <p className="text-slate-400 text-sm mb-4">
              Two chains are tied at <strong className="text-white">{tiedSize} tiles</strong>.
              Pick which one survives:
            </p>
            <div className="flex flex-col gap-2">
              {candidates.map(chainName => {
                const color = CHAIN_COLORS[chainName];
                return (
                  <button
                    key={chainName}
                    onClick={() => handleChoice(chainName)}
                    className={`
                      py-3 rounded-xl font-bold text-sm transition-all active:scale-95
                      ${color.bg} ${color.text}
                    `}
                  >
                    {CHAIN_LABELS[chainName]}
                    <span className="ml-2 font-normal opacity-80">
                      ({gameState.chains[chainName].size} tiles)
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-slate-400 text-sm mt-2">
            Waiting for <strong className="text-white">{activePlayer?.name}</strong> to
            choose the surviving chain…
          </p>
        )}

      </div>
    </div>
  );
}
