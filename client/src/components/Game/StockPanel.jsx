import { useState, useEffect } from 'react';
import socket from '../../socket.js';
import useStore from '../../store.js';
import { CHAIN_COLORS } from './Board/BoardCell.jsx';
import { CHAIN_ORDER, CHAIN_LABELS, getStockPrice, formatDollars } from '../../utils/gameConstants.js';

export default function StockPanel() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);
  const roomCode   = useStore(s => s.roomCode);

  // Local purchase state: { chainName: quantity, ... }
  // Stays empty until player clicks + buttons.
  const [purchases, setPurchases] = useState({});

  // Reset the form whenever it becomes a new player's buy phase
  // (keyed on both activePlayerIndex and turnPhase so it resets correctly)
  useEffect(() => {
    setPurchases({});
  }, [gameState?.activePlayerIndex, gameState?.turnPhase]);

  if (!gameState || gameState.turnPhase !== 'BUY_STOCKS') return null;

  const activePlayer = gameState.players[gameState.activePlayerIndex];
  const isMyTurn     = activePlayer?.id === myPlayerId;
  const me           = gameState.players.find(p => p.id === myPlayerId);

  // Running totals computed from the current purchase state
  const totalBuying = Object.values(purchases).reduce((s, q) => s + q, 0);
  const totalCost   = Object.entries(purchases).reduce((sum, [chainName, qty]) => {
    return sum + getStockPrice(chainName, gameState.chains[chainName].size) * qty;
  }, 0);

  const activeChains = CHAIN_ORDER.filter(name => gameState.chains[name].isActive);

  function adjustQty(chainName, delta) {
    setPurchases(prev => {
      const current    = prev[chainName] ?? 0;
      const bankLeft   = gameState.stockBank[chainName];
      const afterDelta = Math.max(0, Math.min(current + delta, bankLeft));

      // Can't go over 3 total
      const newTotal = totalBuying - current + afterDelta;
      if (newTotal > 3) return prev;

      // Can't spend more than available cash
      const pricePerShare = getStockPrice(chainName, gameState.chains[chainName].size);
      const newCost = totalCost - current * pricePerShare + afterDelta * pricePerShare;
      if (newCost > me.cash) return prev;

      const updated = { ...prev, [chainName]: afterDelta };
      if (updated[chainName] === 0) delete updated[chainName];
      return updated;
    });
  }

  function handleEndTurn() {
    const purchaseList = Object.entries(purchases)
      .filter(([, qty]) => qty > 0)
      .map(([chainName, quantity]) => ({ chainName, quantity }));

    socket.emit('game:endTurn', { playerId: myPlayerId, roomCode, purchases: purchaseList });
  }

  // Non-active player sees a simple waiting message
  if (!isMyTurn) {
    return (
      <div className="mt-2 p-3 bg-slate-800 rounded-xl text-center text-slate-600 text-xs italic">
        Waiting for {activePlayer?.name} to buy stocks…
      </div>
    );
  }

  return (
    <div className="mt-2 bg-slate-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
          Buy Stocks
        </p>
        <span className="text-xs text-slate-500">
          {totalBuying}/3 · {formatDollars(totalCost)}
        </span>
      </div>

      {activeChains.length === 0 ? (
        <p className="px-3 py-3 text-slate-600 text-xs italic">
          No active chains yet — place a tile to start one.
        </p>
      ) : (
        <div className="p-2 space-y-1.5">
          {activeChains.map(chainName => {
            const chain     = gameState.chains[chainName];
            const price     = getStockPrice(chainName, chain.size);
            const bankLeft  = gameState.stockBank[chainName];
            const qty       = purchases[chainName] ?? 0;
            const color     = CHAIN_COLORS[chainName];

            // + is disabled if: already at 3 total, or bank is empty, or can't afford one more
            const canAdd = totalBuying < 3
              && bankLeft > qty
              && me.cash >= totalCost + price;

            return (
              <div
                key={chainName}
                className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-2 py-1.5"
              >
                {/* Color dot + name */}
                <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${color.bg}`} />
                <span className="text-xs font-medium text-slate-300 flex-1">
                  {CHAIN_LABELS[chainName]}
                </span>

                {/* Price */}
                <span className="text-xs text-slate-500 tabular-nums">${price}</span>

                {/* − qty + controls */}
                <button
                  onClick={() => adjustQty(chainName, -1)}
                  disabled={qty === 0}
                  className="w-5 h-5 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-25 text-white text-xs font-bold flex items-center justify-center transition-colors"
                >−</button>

                <span className="w-4 text-center text-sm font-bold text-white tabular-nums">
                  {qty}
                </span>

                <button
                  onClick={() => adjustQty(chainName, +1)}
                  disabled={!canAdd}
                  className="w-5 h-5 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-25 text-white text-xs font-bold flex items-center justify-center transition-colors"
                >+</button>
              </div>
            );
          })}
        </div>
      )}

      {/* End Turn button */}
      <div className="px-2 pb-2">
        <button
          onClick={handleEndTurn}
          className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] rounded-lg font-semibold text-sm transition-all"
        >
          {totalBuying > 0
            ? `Buy ${totalBuying} share${totalBuying > 1 ? 's' : ''} (${formatDollars(totalCost)}) & End Turn`
            : 'End Turn — skip buying'}
        </button>
      </div>
    </div>
  );
}
