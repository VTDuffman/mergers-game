import useStore from '../../store.js';
import socket   from '../../socket.js';
import { formatDollars } from '../../utils/gameConstants.js';

/** Medal label for the top three finishers. */
const MEDALS = ['🥇', '🥈', '🥉'];

export default function ScoreScreen() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);
  const roomCode   = useStore(s => s.roomCode);

  function handlePlayAgain() {
    socket.emit('game:playAgain', { playerId: myPlayerId, roomCode });
  }

  if (!gameState?.isGameOver) return null;

  // Sort players by final cash, highest first
  const ranked = [...gameState.players].sort((a, b) => b.cash - a.cash);
  const winnerId = gameState.winner;

  return (
    // Full-screen backdrop — sits on top of all game UI
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">

      <div className="w-full max-w-lg mx-4 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-6 text-center">
          <p className="text-xs uppercase tracking-widest text-indigo-200 font-semibold mb-1">
            Game Over
          </p>
          <h1 className="text-3xl font-bold text-white">
            {ranked[0]?.name} Wins!
          </h1>
          <p className="text-indigo-200 text-sm mt-1">
            Final cash: {formatDollars(ranked[0]?.cash)}
          </p>
        </div>

        {/* ── Leaderboard ── */}
        <ul className="divide-y divide-slate-700/60">
          {ranked.map((player, index) => {
            const isWinner = player.id === winnerId;
            const isMe     = player.id === myPlayerId;
            const medal    = MEDALS[index] ?? null;

            return (
              <li
                key={player.id}
                className={`
                  flex items-center gap-4 px-6 py-4 transition-colors
                  ${isWinner ? 'bg-indigo-950/60' : 'bg-slate-900'}
                `}
              >
                {/* Rank / medal */}
                <span className="w-8 text-center text-xl flex-shrink-0">
                  {medal ?? <span className="text-slate-500 text-base font-semibold">#{index + 1}</span>}
                </span>

                {/* Name block */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`
                      font-semibold truncate
                      ${isWinner ? 'text-indigo-300' : 'text-slate-100'}
                    `}>
                      {player.name}
                    </span>

                    {isMe && (
                      <span className="text-[10px] uppercase tracking-wide bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                        you
                      </span>
                    )}

                    {player.isRetired && (
                      <span className="text-[10px] uppercase tracking-wide bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">
                        retired
                      </span>
                    )}
                  </div>
                </div>

                {/* Final cash — right-aligned, always prominent */}
                <span className={`
                  text-lg font-bold tabular-nums flex-shrink-0
                  ${isWinner ? 'text-indigo-300' : 'text-slate-200'}
                `}>
                  {formatDollars(player.cash)}
                </span>
              </li>
            );
          })}
        </ul>

        {/* ── Footer ── */}
        <div className="px-8 py-5 bg-slate-800/50 flex justify-center">
          <button
            onClick={handlePlayAgain}
            className="
              px-8 py-3 rounded-xl font-semibold text-sm
              bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700
              text-white transition-colors shadow-lg shadow-indigo-900/40
              focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2
              focus:ring-offset-slate-800
            "
          >
            Play Again
          </button>
        </div>

      </div>
    </div>
  );
}
