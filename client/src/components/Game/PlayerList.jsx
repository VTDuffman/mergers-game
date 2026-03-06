import useStore from '../../store.js';
import { getStockPrice, formatDollars } from '../../utils/gameConstants.js';

/** Market value of a player's stock portfolio (inactive chains worth $0). */
function calcStockValue(player, chains) {
  let value = 0;
  for (const [chainName, qty] of Object.entries(player.stocks)) {
    if (qty > 0 && chains[chainName]?.isActive) {
      value += qty * getStockPrice(chainName, chains[chainName].size);
    }
  }
  return value;
}

export default function PlayerList() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);

  if (!gameState) return null;

  const activePlayer = gameState.players[gameState.activePlayerIndex];

  // Sort by net worth descending so this acts as a live leaderboard
  const sorted = [...gameState.players].sort((a, b) => {
    const aNet = a.cash + calcStockValue(a, gameState.chains);
    const bNet = b.cash + calcStockValue(b, gameState.chains);
    return bNet - aNet;
  });

  return (
    <div className="bg-slate-800 rounded-xl overflow-hidden h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-700 flex-shrink-0">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
          Players — Live Standings
        </p>
      </div>

      {/* Column headers */}
      <div className="px-3 py-1 border-b border-slate-700/50 flex-shrink-0
                      grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-2
                      text-[9px] uppercase tracking-wider text-slate-500">
        <span />{/* rank */}
        <span>Player</span>
        <span className="text-right">Cash</span>
        <span className="text-right">Stocks</span>
        <span className="text-right">Net</span>
      </div>

      <ul className="overflow-y-auto flex-1">
        {sorted.map((player, rank) => {
          const isActive   = player.id === activePlayer?.id;
          const isMe       = player.id === myPlayerId;
          const stockValue = calcStockValue(player, gameState.chains);
          const netWorth   = player.cash + stockValue;

          return (
            <li
              key={player.id}
              className={`
                px-3 py-2 border-b border-slate-700/50 last:border-0
                border-l-2 transition-colors
                ${isActive ? 'border-l-indigo-500 bg-indigo-900/20' : 'border-l-transparent'}
              `}
            >
              {/* Name row */}
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] text-slate-500 font-mono w-4 flex-shrink-0 text-right">
                  #{rank + 1}
                </span>
                <span className={`text-sm font-medium truncate flex-1
                  ${player.isRetired ? 'line-through text-slate-500' : 'text-white'}`}>
                  {player.name}
                </span>
                {isMe       && <span className="text-[9px] text-slate-500 flex-shrink-0">(you)</span>}
                {isActive && !isMe && <span className="text-[9px] text-indigo-400 flex-shrink-0">▶</span>}
                {player.isRetired && <span className="text-[9px] text-slate-600 flex-shrink-0">retired</span>}
              </div>

              {/* Cash | Stock Value | Net Worth — aligned to header columns */}
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-2 text-[10px] tabular-nums">
                <span />{/* rank spacer */}
                <span />{/* name spacer */}
                <span className="text-right text-slate-400">{formatDollars(player.cash)}</span>
                <span className="text-right text-slate-400">{formatDollars(stockValue)}</span>
                <span className="text-right text-slate-200 font-bold">{formatDollars(netWorth)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
