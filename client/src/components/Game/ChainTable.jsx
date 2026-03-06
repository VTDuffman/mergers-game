import { Fragment } from 'react';
import useStore from '../../store.js';
import { CHAIN_COLORS } from './Board/BoardCell.jsx';
import { CHAIN_ORDER, CHAIN_LABELS, getStockPrice } from '../../utils/gameConstants.js';

/**
 * For an active chain, returns every player annotated with their bonus rank:
 *   '1st'  — sole majority holder
 *   'tie'  — tied for the most shares (all tied leaders split both bonuses)
 *   '2nd'  — sole second-place holder (or tied for second behind a sole leader)
 *   null   — everyone else
 * Players are sorted by share count descending; zero-holders are included last.
 */
function getRankedHolders(players, chainName) {
  const sorted = [...players]
    .map(p => ({ id: p.id, name: p.name, shares: p.stocks[chainName] ?? 0 }))
    .sort((a, b) => b.shares - a.shares);

  if (sorted.length === 0) return sorted;

  const topShares  = sorted[0].shares;
  const topTied    = sorted.filter(p => p.shares === topShares && p.shares > 0);

  // If the leader is tied, everyone at the top splits both bonuses — no separate 2nd place
  const secondShares = (topTied.length === 1 && sorted.length > 1)
    ? sorted.find(p => p.shares < topShares && p.shares > 0)?.shares ?? null
    : null;

  return sorted.map(p => {
    if (p.shares === topShares && p.shares > 0) {
      return { ...p, rank: topTied.length > 1 ? 'tie' : '1st' };
    }
    if (secondShares !== null && p.shares === secondShares) {
      return { ...p, rank: '2nd' };
    }
    return { ...p, rank: null };
  });
}

export default function ChainTable() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);

  if (!gameState) return null;

  return (
    <div className="bg-slate-800 rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
          Hotel Chains
        </p>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-slate-500 border-b border-slate-700">
            <th className="px-2 py-1.5 text-left">Chain</th>
            <th className="px-1 py-1.5 text-right" title="Number of tiles in the chain">Size</th>
            <th className="px-1 py-1.5 text-right" title="Current stock price">$/sh</th>
            <th className="px-1 py-1.5 text-right" title="Shares remaining in bank">Bank</th>
          </tr>
        </thead>
        <tbody>
          {CHAIN_ORDER.map(chainName => {
            const chain    = gameState.chains[chainName];
            const color    = CHAIN_COLORS[chainName];
            const price    = getStockPrice(chainName, chain.size);
            const bankLeft = gameState.stockBank[chainName];

            if (!chain.isActive) {
              return (
                <tr key={chainName} className="border-b border-slate-700/30 last:border-0 opacity-35">
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-slate-600" />
                      <span className="text-slate-500">{CHAIN_LABELS[chainName]}</span>
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-right text-slate-600">—</td>
                  <td className="px-1 py-1.5 text-right text-slate-600">—</td>
                  <td className="px-1 py-1.5 text-right text-slate-600">{bankLeft}</td>
                </tr>
              );
            }

            const ranked = getRankedHolders(gameState.players, chainName);

            return (
              <Fragment key={chainName}>
                {/* Main chain row */}
                <tr className="border-b border-slate-700/20">
                  <td className="px-2 pt-2 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${color.bg}`} />
                      <span className="text-white font-medium">{CHAIN_LABELS[chainName]}</span>
                    </div>
                  </td>
                  <td className={`px-1 pt-2 pb-1 text-right tabular-nums font-medium
                    ${chain.isSafe ? 'text-red-400' : 'text-slate-300'}`}>
                    {chain.size}{chain.isSafe && <span className="text-[8px] ml-0.5">🔒</span>}
                  </td>
                  <td className="px-1 pt-2 pb-1 text-right tabular-nums text-slate-300">
                    ${price}
                  </td>
                  <td className="px-1 pt-2 pb-1 text-right tabular-nums text-slate-500">
                    {bankLeft}
                  </td>
                </tr>

                {/* Per-player holdings row */}
                <tr className="border-b border-slate-700/50 last:border-0">
                  <td colSpan={4} className="px-2 pb-2">
                    {ranked.every(p => p.shares === 0) ? (
                      <span className="text-[10px] text-slate-600 italic">No shares held</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {ranked.map(({ id, name, shares, rank }) => {
                          const isMe = id === myPlayerId;
                          // Badge label + color based on rank
                          const badge =
                            rank === '1st' ? <span className="text-yellow-400 font-bold ml-0.5">1st</span> :
                            rank === 'tie' ? <span className="text-yellow-500 ml-0.5">tie</span> :
                            rank === '2nd' ? <span className="text-slate-400 ml-0.5">2nd</span> :
                            null;

                          return (
                            <span
                              key={id}
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px]
                                ${isMe
                                  ? 'bg-indigo-900/60 border border-indigo-700'
                                  : 'bg-slate-700/60 border border-slate-600'}
                                ${shares === 0 ? 'opacity-40' : ''}`}
                            >
                              <span className={isMe ? 'text-indigo-200' : 'text-slate-300'}>
                                {name}
                              </span>
                              <span className="tabular-nums font-bold text-white ml-1">{shares}</span>
                              {badge}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Legend */}
      <div className="px-3 py-1.5 border-t border-slate-700 text-[9px] text-slate-600 space-y-0.5">
        <div>
          <span className="text-yellow-400 font-bold">1st</span> = majority bonus &nbsp;
          <span className="text-slate-400">2nd</span> = minority bonus &nbsp;
          <span className="text-yellow-500">tie</span> = split both bonuses
        </div>
        <div><span className="text-red-400">Red size</span> = safe (11+ tiles, cannot be merged)</div>
      </div>
    </div>
  );
}
