import useStore from '../../store.js';
import { getStockPrice, formatDollars } from '../../utils/gameConstants.js';

/**
 * Calculate a player's net worth: cash + market value of all stock holdings.
 * Stock in inactive chains is worth $0.
 */
function calcNetWorth(player, chains) {
  let worth = player.cash;
  for (const [chainName, qty] of Object.entries(player.stocks)) {
    if (qty > 0 && chains[chainName]?.isActive) {
      worth += qty * getStockPrice(chainName, chains[chainName].size);
    }
  }
  return worth;
}

export default function PlayerList() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);

  if (!gameState) return null;

  const activePlayer = gameState.players[gameState.activePlayerIndex];

  return (
    <div className="bg-slate-800 rounded-xl overflow-hidden h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-700 flex-shrink-0">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
          Players
        </p>
      </div>

      <ul className="overflow-y-auto flex-1">
        {gameState.players.map(player => {
          const isActive = player.id === activePlayer?.id;
          const isMe     = player.id === myPlayerId;
          const netWorth = calcNetWorth(player, gameState.chains);

          return (
            <li
              key={player.id}
              className={`
                px-3 py-3 border-b border-slate-700/50 last:border-0
                border-l-2 transition-colors
                ${isActive ? 'border-l-indigo-500 bg-indigo-900/20' : 'border-l-transparent'}
              `}
            >
              {/* Name row */}
              <div className="flex items-center gap-1 mb-1.5">
                <span className={`
                  text-sm font-medium truncate
                  ${player.isRetired ? 'line-through text-slate-500' : 'text-white'}
                `}>
                  {player.name}
                </span>
                {isMe     && <span className="text-[9px] text-slate-500 ml-auto flex-shrink-0">(you)</span>}
                {isActive && !isMe && <span className="text-[9px] text-indigo-400 ml-auto flex-shrink-0">▶</span>}
              </div>

              {/* Cash + net worth */}
              <div className="text-xs space-y-0.5 text-slate-400">
                <div>Cash: {formatDollars(player.cash)}</div>
                <div className="text-slate-200 font-semibold">
                  Net: {formatDollars(netWorth)}
                </div>
              </div>

              {player.isRetired && (
                <div className="text-[10px] text-slate-600 mt-1">Retired</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
