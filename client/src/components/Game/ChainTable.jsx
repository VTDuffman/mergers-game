import useStore from '../../store.js';
import { CHAIN_COLORS } from './Board/BoardCell.jsx';
import { CHAIN_ORDER, CHAIN_LABELS, getStockPrice } from '../../utils/gameConstants.js';

export default function ChainTable() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);

  if (!gameState) return null;

  const me = gameState.players.find(p => p.id === myPlayerId);

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
            <th className="px-1 py-1.5 text-right" title="Shares you own">Mine</th>
            <th className="px-1 py-1.5 text-right" title="Shares remaining in bank">Bank</th>
          </tr>
        </thead>
        <tbody>
          {CHAIN_ORDER.map(chainName => {
            const chain    = gameState.chains[chainName];
            const color    = CHAIN_COLORS[chainName];
            const price    = getStockPrice(chainName, chain.size);
            const myShares = me?.stocks[chainName] ?? 0;
            const bankLeft = gameState.stockBank[chainName];

            // Majority: I own >= the most any other player owns (and I own at least 1)
            const maxOtherShares = Math.max(
              0,
              ...gameState.players
                .filter(p => p.id !== myPlayerId)
                .map(p => p.stocks[chainName] ?? 0)
            );
            const hasMajority = myShares > 0 && myShares >= maxOtherShares;

            if (!chain.isActive) {
              // Inactive chain — show greyed-out row
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
                  <td className="px-1 py-1.5 text-right text-slate-600">—</td>
                  <td className="px-1 py-1.5 text-right text-slate-600">{bankLeft}</td>
                </tr>
              );
            }

            return (
              <tr key={chainName} className="border-b border-slate-700/50 last:border-0">
                {/* Chain name + color dot */}
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${color.bg}`} />
                    <span className={`${hasMajority ? 'font-bold text-white' : 'text-slate-300'}`}>
                      {CHAIN_LABELS[chainName]}
                    </span>
                  </div>
                </td>

                {/* Size — red if safe (11+) */}
                <td className={`px-1 py-1.5 text-right tabular-nums font-medium
                  ${chain.isSafe ? 'text-red-400' : 'text-slate-300'}`}>
                  {chain.size}
                  {chain.isSafe && <span className="text-[8px] ml-0.5">🔒</span>}
                </td>

                {/* Stock price */}
                <td className="px-1 py-1.5 text-right tabular-nums text-slate-300">
                  ${price}
                </td>

                {/* My shares — bold+white if majority */}
                <td className={`px-1 py-1.5 text-right tabular-nums
                  ${hasMajority ? 'font-bold text-white' : 'text-slate-400'}`}>
                  {myShares || '—'}
                </td>

                {/* Shares left in bank */}
                <td className="px-1 py-1.5 text-right tabular-nums text-slate-500">
                  {bankLeft}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Legend */}
      <div className="px-3 py-1.5 border-t border-slate-700 text-[9px] text-slate-600 space-y-0.5">
        <div><span className="font-bold text-slate-500">Bold</span> = you hold majority</div>
        <div><span className="text-red-400">Red size</span> = safe (11+ tiles, cannot be merged)</div>
      </div>
    </div>
  );
}
