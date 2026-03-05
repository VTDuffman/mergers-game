import { useState, useEffect } from 'react';
import socket from '../../../socket.js';
import useStore from '../../../store.js';
import { CHAIN_COLORS } from '../Board/BoardCell.jsx';
import { CHAIN_LABELS, getStockPrice, formatDollars } from '../../../utils/gameConstants.js';

export default function MergerDecisionDialog() {
  const gameState  = useStore(s => s.gameState);
  const myPlayerId = useStore(s => s.myPlayerId);
  const roomCode   = useStore(s => s.roomCode);

  const [sell, setSell]   = useState(0);
  const [trade, setTrade] = useState(0);

  // Reset whenever it becomes a new player's turn to decide
  const decidingId = gameState?.mergerContext?.pendingDecisions?.[0];
  useEffect(() => {
    setSell(0);
    setTrade(0);
  }, [decidingId]);

  if (!gameState || gameState.turnPhase !== 'MERGER_DECISIONS') return null;

  const mc            = gameState.mergerContext;
  const defunctChain  = mc?.currentDefunct;
  const survivorChain = mc?.survivorChain;
  if (!defunctChain || !survivorChain) return null;

  const isMyDecision   = decidingId === myPlayerId;
  const decidingPlayer = gameState.players.find(p => p.id === decidingId);
  const me             = gameState.players.find(p => p.id === myPlayerId);

  const defunctColor  = CHAIN_COLORS[defunctChain];
  const survivorColor = CHAIN_COLORS[survivorChain];
  const defunctLabel  = CHAIN_LABELS[defunctChain];
  const survivorLabel = CHAIN_LABELS[survivorChain];

  const owned        = me?.stocks?.[defunctChain] ?? 0;
  const bankSurvivor = gameState.stockBank?.[survivorChain] ?? 0;
  const defunctPrice = getStockPrice(defunctChain, gameState.chains[defunctChain].size);
  const keep         = owned - sell - trade;

  function adjustSell(delta) {
    setSell(prev => Math.max(0, Math.min(prev + delta, owned - trade)));
  }

  function adjustTrade(delta) {
    // Trade must stay even; capped by remaining shares (after sell) and bank availability
    setTrade(prev => {
      const maxTrade = Math.min(
        Math.floor((owned - sell) / 2) * 2,
        bankSurvivor * 2,
      );
      return Math.max(0, Math.min(prev + delta, maxTrade));
    });
  }

  function handleSubmit() {
    socket.emit('game:mergerDecision', { playerId: myPlayerId, roomCode, sell, trade });
  }

  const canAddSell  = sell + trade < owned;
  const canAddTrade = sell + trade + 2 <= owned && (trade + 2) / 2 <= bankSurvivor;

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl p-5 max-w-sm w-full mx-4 shadow-2xl border border-slate-700">

        {/* Header: defunct → survivor */}
        <div className="mb-4">
          <h2 className="text-white font-bold text-lg">Merger Resolution</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium`}>
              <span className={`w-2.5 h-2.5 rounded-sm ${defunctColor.bg}`} />
              <span className="text-slate-300">{defunctLabel}</span>
            </span>
            <span className="text-slate-600 text-xs">absorbed by</span>
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium`}>
              <span className={`w-2.5 h-2.5 rounded-sm ${survivorColor.bg}`} />
              <span className="text-slate-300">{survivorLabel}</span>
            </span>
          </div>
        </div>

        {isMyDecision ? (
          <>
            <p className="text-slate-400 text-xs mb-3">
              You hold <strong className="text-white">{owned}</strong> {defunctLabel} share{owned !== 1 ? 's' : ''} at{' '}
              <strong className="text-white">{formatDollars(defunctPrice)}</strong> each.
              Choose what to do:
            </p>

            {/* Sell row */}
            <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2 mb-2">
              <span className="text-sm text-slate-300 flex-1">Sell</span>
              <button
                onClick={() => adjustSell(-1)} disabled={sell === 0}
                className="w-6 h-6 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-25 text-white text-xs font-bold"
              >−</button>
              <span className="w-6 text-center text-sm font-bold text-white tabular-nums">{sell}</span>
              <button
                onClick={() => adjustSell(+1)} disabled={!canAddSell}
                className="w-6 h-6 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-25 text-white text-xs font-bold"
              >+</button>
              <span className="text-xs text-emerald-400 w-16 text-right tabular-nums">
                {sell > 0 ? `+${formatDollars(sell * defunctPrice)}` : ''}
              </span>
            </div>

            {/* Trade row */}
            <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2 mb-2">
              <span className="text-sm text-slate-300 flex-1">Trade <span className="text-slate-500 text-xs">(2:1)</span></span>
              <button
                onClick={() => adjustTrade(-2)} disabled={trade === 0}
                className="w-6 h-6 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-25 text-white text-xs font-bold"
              >−</button>
              <span className="w-6 text-center text-sm font-bold text-white tabular-nums">{trade}</span>
              <button
                onClick={() => adjustTrade(+2)} disabled={!canAddTrade}
                className="w-6 h-6 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-25 text-white text-xs font-bold"
              >+</button>
              <span className="text-xs text-blue-400 w-16 text-right tabular-nums">
                {trade > 0 ? `→ ${trade / 2} ${survivorLabel}` : ''}
              </span>
            </div>

            {/* Keep row (calculated) */}
            <div className="flex items-center gap-2 bg-slate-700/30 rounded-lg px-3 py-2 mb-4">
              <span className="text-sm text-slate-400 flex-1">Keep</span>
              <span className="text-sm font-bold text-slate-300 tabular-nums">{keep}</span>
              <span className="w-16" />
            </div>

            <button
              onClick={handleSubmit}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] rounded-xl font-semibold text-sm transition-all"
            >
              Confirm Decision
            </button>
          </>
        ) : (
          <p className="text-slate-400 text-sm">
            Waiting for <strong className="text-white">{decidingPlayer?.name ?? '…'}</strong> to decide…
          </p>
        )}

      </div>
    </div>
  );
}
