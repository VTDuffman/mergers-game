import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import BoardCell, { CHAIN_COLORS } from '../components/Game/Board/BoardCell.jsx';
import { CHAIN_ORDER, CHAIN_LABELS, getStockPrice, formatDollars } from '../utils/gameConstants.js';

// ---- Board geometry ----
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// ---- Client-side tile classification ----
// Mirrors server/game/boardLogic.js — used for UX highlighting only.
// The server performs the authoritative check on each API call.
function getAdjacentCells(tileId) {
  const col    = tileId[0];
  const row    = parseInt(tileId.slice(1));
  const colIdx = COLS.indexOf(col);
  const adj    = [];
  if (colIdx > 0)  adj.push(`${COLS[colIdx - 1]}${row}`);
  if (colIdx < 11) adj.push(`${COLS[colIdx + 1]}${row}`);
  if (row > 1)     adj.push(`${col}${row - 1}`);
  if (row < 9)     adj.push(`${col}${row + 1}`);
  return adj;
}

function classifyTile(board, chains, tileId) {
  if (!board || board[tileId] !== 'empty') return 'illegal';
  const adj       = getAdjacentCells(tileId);
  const adjChains = [...new Set(adj.map(id => board[id]).filter(s => s !== 'empty' && s !== 'lone'))];
  const adjLone   = adj.filter(id => board[id] === 'lone');
  if (adjChains.length >= 2) {
    return adjChains.filter(n => chains[n]?.isSafe).length >= 2 ? 'illegal' : 'merge';
  }
  if (adjChains.length === 1) return 'grow';
  if (adjLone.length > 0) {
    return Object.values(chains).filter(c => c.isActive).length >= 7 ? 'illegal' : 'found';
  }
  return 'simple';
}

function getAvailableChains(chains) {
  return CHAIN_ORDER.filter(name => !chains[name]?.isActive);
}

function calcNetWorth(player, chains) {
  let worth = player.cash;
  for (const [name, qty] of Object.entries(player.stocks)) {
    if (qty > 0 && chains[name]?.isActive) {
      worth += qty * getStockPrice(name, chains[name].size);
    }
  }
  return worth;
}

// ============================================================
// GamePage
// Props:
//   gameId   {string}  — UUID of the active game
//   navigate {object}  — { toDashboard } navigation helpers
// ============================================================
export default function GamePage({ gameId, navigate }) {
  const { user } = useAuth();

  // ---- Server state (polled) ----
  const [publicState,   setPublicState]   = useState(null);
  const [myTiles,       setMyTiles]       = useState([]);
  const [drawPileCount, setDrawPileCount] = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [pollError,     setPollError]     = useState('');

  // ---- Local turn state ----
  // pendingFoundTile: tile held in memory while the chain-name modal is open
  const [pendingFoundTile, setPendingFoundTile] = useState(null);
  const [showNameModal,    setShowNameModal]    = useState(false);

  // Stocks to buy — built up locally, submitted with End Turn
  const [stocksToBuy,  setStocksToBuy]  = useState({});  // { chainName: qty }

  // ---- Loading / error flags ----
  const [placing,    setPlacing]    = useState(false);  // play-tile in flight
  const [ending,     setEnding]     = useState(false);  // end-turn in flight
  const [actionError, setActionError] = useState('');

  const pollingRef = useRef(null);

  // ---- Helpers to apply a server response to local state ----
  function applyServerResponse(data) {
    setPublicState(data.publicState);
    setMyTiles(data.myTiles);
    setDrawPileCount(data.drawPileCount);
    setPollError('');
  }

  // ---- Polling ----
  const fetchState = useCallback(async () => {
    try {
      const data = await api.getGameState(gameId);
      applyServerResponse(data);
    } catch (err) {
      setPollError(err.message);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    fetchState();
    pollingRef.current = setInterval(fetchState, 10_000);
    return () => clearInterval(pollingRef.current);
  }, [fetchState]);

  // ---- Derived values ----
  const activePlayer  = publicState?.players?.[publicState.activePlayerIndex];
  const isMyTurn      = activePlayer?.id === user?.id;
  const isPlacePhase  = publicState?.turnPhase === 'PLACE_TILE';
  const isBuyPhase    = publicState?.turnPhase === 'BUY_STOCKS';
  const myPlayerInfo  = publicState?.players?.find(p => p.id === user?.id);

  // Pre-classify every tile in hand for highlighting
  const tileClassifications = {};
  if (publicState?.board) {
    for (const tile of myTiles) {
      tileClassifications[tile] = classifyTile(publicState.board, publicState.chains, tile);
    }
  }

  const totalStocksToBuy = Object.values(stocksToBuy).reduce((s, q) => s + q, 0);

  // ---- Step 1: tile clicked ----
  async function handleTileClick(tileId) {
    if (!isMyTurn || !isPlacePhase || placing) return;
    const cls = tileClassifications[tileId];
    if (!cls || cls === 'illegal') return;

    if (cls === 'merge') {
      setActionError('Mergers coming soon! This tile would trigger a merger and cannot be played yet.');
      return;
    }

    setActionError('');

    // Founding tiles need a chain name before we can call the API.
    // Show the modal and hold the tile in memory.
    if (cls === 'found') {
      setPendingFoundTile(tileId);
      setShowNameModal(true);
      return;
    }

    // Simple / grow: call play-tile immediately
    await submitPlayTile(tileId, null);
  }

  // Called from the name modal when the player picks a chain
  async function handleChainChosen(chainName) {
    setShowNameModal(false);
    await submitPlayTile(pendingFoundTile, chainName);
    setPendingFoundTile(null);
  }

  function handleCancelNameModal() {
    setShowNameModal(false);
    setPendingFoundTile(null);
  }

  async function submitPlayTile(tilePlaced, chainFounded) {
    setPlacing(true);
    setActionError('');
    try {
      const data = await api.playTile(gameId, { tilePlaced, chainFounded });
      applyServerResponse(data);
      setStocksToBuy({}); // reset stock selection for this new buy phase
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPlacing(false);
    }
  }

  // ---- Stock quantity adjustment (local only, submitted with End Turn) ----
  function adjustStock(chainName, delta) {
    const currentQty = stocksToBuy[chainName] ?? 0;
    const newQty     = currentQty + delta;
    if (newQty < 0) return;
    if (delta > 0 && totalStocksToBuy >= 3) return;
    if (newQty > (publicState.stockBank[chainName] ?? 0)) return;
    setStocksToBuy(prev => {
      const next = { ...prev, [chainName]: newQty };
      if (newQty === 0) delete next[chainName];
      return next;
    });
  }

  // ---- Step 3: End Turn ----
  async function handleEndTurn() {
    if (!isMyTurn || !isBuyPhase || ending) return;
    setEnding(true);
    setActionError('');
    try {
      const data = await api.endTurn(gameId, stocksToBuy);
      applyServerResponse(data);
      setStocksToBuy({});
    } catch (err) {
      setActionError(err.message);
    } finally {
      setEnding(false);
    }
  }

  // ---- Loading / error screens ----
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <p className="text-slate-500 text-sm">Loading game…</p>
      </div>
    );
  }

  if (!publicState) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{pollError || 'Game state not found.'}</p>
          <button onClick={navigate.toDashboard} className="text-blue-400 underline text-sm">
            ← Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  // ---- Main render ----
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">

      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-slate-700 bg-slate-900/95 sticky top-0 z-20 gap-4">
        <button
          onClick={navigate.toDashboard}
          className="text-slate-400 hover:text-white text-sm transition-colors flex-shrink-0"
        >
          ← Dashboard
        </button>

        {/* Turn indicator — always visible in the center */}
        <div className="text-center flex-1">
          {isMyTurn ? (
            <span className="font-semibold text-sm">
              {isPlacePhase
                ? <span className="text-green-400">Your turn — place a tile</span>
                : <span className="text-yellow-400">Your turn — buy stocks &amp; end turn</span>
              }
            </span>
          ) : (
            <span className="text-slate-400 text-sm">
              Waiting for <span className="text-white font-medium">{activePlayer?.name}</span>
            </span>
          )}
        </div>

        <div className="text-slate-500 text-xs flex-shrink-0">
          Turn {publicState.turnNumber} · {drawPileCount} tiles left
        </div>
      </header>

      {/* ── Body: board (left) + sidebar (right) ── */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">

        {/* ── Board ── */}
        <main className="flex-1 flex flex-col p-2 sm:p-4 overflow-auto">

          {pollError && (
            <p className="text-amber-400 text-xs text-center mb-2">⚠ {pollError} — retrying…</p>
          )}

          <div className="w-full max-w-4xl mx-auto overflow-x-auto">
            {/* 13-column CSS grid: 1 narrow label col + 12 equal board cols */}
            <div className="grid grid-cols-[1.5rem_repeat(12,1fr)] gap-0.5 sm:gap-1">

              <div /> {/* top-left corner spacer */}

              {/* Column headers A–L */}
              {COLS.map(col => (
                <div key={col} className="text-center text-[clamp(0.4rem,1.2vw,0.65rem)] text-slate-500 font-mono pb-0.5">
                  {col}
                </div>
              ))}

              {/* 9 rows × 12 cols = 108 board cells */}
              {ROWS.flatMap(row => [
                // Row label (1–9)
                <div
                  key={`lbl-${row}`}
                  className="text-[clamp(0.4rem,1.2vw,0.65rem)] text-slate-500 font-mono flex items-center justify-end pr-0.5"
                >
                  {row}
                </div>,

                // 12 cells for this row
                ...COLS.map(col => {
                  const tileId    = `${col}${row}`;
                  const cls       = tileClassifications[tileId];
                  const inHand    = myTiles.includes(tileId);
                  // A tile is clickable only in PLACE_TILE phase when it's legal
                  const clickable = isMyTurn && isPlacePhase && !placing
                    && inHand && cls !== 'illegal' && cls !== 'merge';

                  return (
                    <BoardCell
                      key={tileId}
                      tileId={tileId}
                      cellState={publicState.board[tileId]}
                      isInHand={inHand}
                      isLegal={clickable}
                      isMyTurn={isMyTurn}
                      isPlacePhase={isPlacePhase}
                      onClick={() => handleTileClick(tileId)}
                    />
                  );
                }),
              ])}
            </div>
          </div>

          {/* Recent move log */}
          {publicState.log?.length > 0 && (
            <div className="w-full max-w-4xl mx-auto mt-4 px-1">
              <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Recent moves</p>
              <ul className="space-y-0.5">
                {publicState.log.slice(0, 6).map((entry, i) => (
                  <li key={i} className="text-[11px] text-slate-500">{entry.message}</li>
                ))}
              </ul>
            </div>
          )}
        </main>

        {/* ── Sidebar ── */}
        <aside className="lg:w-72 xl:w-80 border-t lg:border-t-0 lg:border-l border-slate-700 overflow-y-auto flex-shrink-0">

          {/* Hotel chain table */}
          <section className="p-3 border-b border-slate-700">
            <h2 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">
              Hotel Chains
            </h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-slate-500 border-b border-slate-700">
                  <th className="py-1 text-left">Chain</th>
                  <th className="py-1 text-right" title="Tiles in chain">Size</th>
                  <th className="py-1 text-right" title="Stock price per share">$/sh</th>
                  <th className="py-1 text-right" title="Shares remaining in bank">Bank</th>
                  <th className="py-1 text-right" title="Your shares">Mine</th>
                </tr>
              </thead>
              <tbody>
                {CHAIN_ORDER.map(name => {
                  const chain    = publicState.chains[name];
                  const color    = CHAIN_COLORS[name];
                  const price    = getStockPrice(name, chain.size);
                  const bank     = publicState.stockBank[name];
                  const myShares = myPlayerInfo?.stocks[name] ?? 0;
                  return (
                    <tr
                      key={name}
                      className={`border-b border-slate-700/30 last:border-0 ${!chain.isActive ? 'opacity-30' : ''}`}
                    >
                      <td className="py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${chain.isActive ? color.bg : 'bg-slate-600'}`} />
                          <span className={chain.isActive ? 'text-white' : 'text-slate-500'}>
                            {CHAIN_LABELS[name]}
                          </span>
                          {chain.isSafe && <span className="text-red-400 text-[8px]">🔒</span>}
                        </div>
                      </td>
                      <td className={`py-1.5 text-right tabular-nums ${chain.isSafe ? 'text-red-400 font-bold' : 'text-slate-300'}`}>
                        {chain.isActive ? chain.size : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-300">
                        {chain.isActive ? `$${price}` : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">{bank}</td>
                      <td className={`py-1.5 text-right tabular-nums font-bold ${myShares > 0 ? 'text-indigo-300' : 'text-slate-700'}`}>
                        {myShares || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[9px] text-slate-600 mt-1.5">
              🔒 Safe = 11+ tiles (cannot be merged)
            </p>
          </section>

          {/* Player standings */}
          <section className="p-3">
            <h2 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">
              Standings
            </h2>
            <ul className="space-y-2">
              {[...publicState.players]
                .sort((a, b) => calcNetWorth(b, publicState.chains) - calcNetWorth(a, publicState.chains))
                .map((p, rank) => {
                  const isMe     = p.id === user?.id;
                  const isActive = p.id === activePlayer?.id;
                  const net      = calcNetWorth(p, publicState.chains);
                  return (
                    <li
                      key={p.id}
                      className={`rounded-lg px-2.5 py-2 border-l-2 ${
                        isActive ? 'border-indigo-500 bg-indigo-900/20' : 'border-transparent bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] text-slate-500 font-mono w-4 text-right">
                          #{rank + 1}
                        </span>
                        <span className={`text-sm font-semibold flex-1 truncate ${p.isRetired ? 'line-through text-slate-500' : 'text-white'}`}>
                          {p.name}
                        </span>
                        {isMe     && <span className="text-[9px] text-slate-500">(you)</span>}
                        {isActive && !isMe && <span className="text-[9px] text-indigo-400">▶</span>}
                      </div>
                      <div className="ml-5 flex justify-between text-[11px]">
                        <span className="text-slate-500">
                          Cash: <span className="text-slate-300 tabular-nums">{formatDollars(p.cash)}</span>
                        </span>
                        <span className="text-slate-200 font-bold tabular-nums">{formatDollars(net)}</span>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        </aside>
      </div>

      {/* ── Bottom bar: tile hand + buy stocks + end turn ── */}
      <footer className="sticky bottom-0 z-10 bg-slate-900/95 backdrop-blur-sm border-t border-slate-700">

        {/* Error banner */}
        {actionError && (
          <div className="px-4 pt-2">
            <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg px-3 py-2">
              {actionError}
            </div>
          </div>
        )}

        <div className="px-4 py-3 space-y-3">

          {/* ── Tile hand (shown in PLACE_TILE phase) ── */}
          {(isPlacePhase || !isMyTurn) && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-500 text-xs uppercase tracking-wider flex-shrink-0">
                {isMyTurn && isPlacePhase ? 'Your turn — place a tile:' : 'Your tiles:'}
              </span>

              {myTiles.length === 0 && (
                <span className="text-slate-600 text-sm italic">No tiles in hand</span>
              )}

              {myTiles.map(tileId => {
                const cls      = tileClassifications[tileId];
                const canPlace = isMyTurn && isPlacePhase && !placing && cls !== 'illegal';
                const isIllegal = isMyTurn && isPlacePhase && cls === 'illegal';
                const isMerge   = cls === 'merge';

                return (
                  <button
                    key={tileId}
                    onClick={() => handleTileClick(tileId)}
                    disabled={!canPlace || placing}
                    title={
                      isIllegal ? `${tileId} — cannot be played` :
                      isMerge   ? `${tileId} — merger (Phase 4)` :
                      tileId
                    }
                    className={`
                      px-3 py-2 rounded-lg font-mono font-bold text-sm border-2 transition-all touch-manipulation
                      ${canPlace
                        ? 'bg-indigo-600 border-indigo-400 text-white hover:bg-indigo-500 active:scale-95 cursor-pointer'
                        : (isIllegal || isMerge)
                          ? 'bg-slate-800 border-slate-700 text-slate-600 opacity-40 cursor-not-allowed'
                          : 'bg-slate-700 border-slate-600 text-slate-300 cursor-default'
                      }
                    `}
                  >
                    {placing ? '…' : tileId}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Buy stocks panel (shown in BUY_STOCKS phase) ── */}
          {isMyTurn && isBuyPhase && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs uppercase tracking-wider">
                  Buy stocks (optional, max 3 total)
                </span>
                <span className="text-slate-500 text-xs tabular-nums">
                  {totalStocksToBuy}/3
                </span>
              </div>

              {/* One pill per active chain with enough bank shares */}
              <div className="flex flex-wrap gap-2">
                {CHAIN_ORDER
                  .filter(name => publicState.chains[name].isActive && publicState.stockBank[name] > 0)
                  .map(name => {
                    const qty    = stocksToBuy[name] ?? 0;
                    const price  = getStockPrice(name, publicState.chains[name].size);
                    const color  = CHAIN_COLORS[name];
                    const canAdd = totalStocksToBuy < 3 && qty < publicState.stockBank[name];

                    return (
                      <div
                        key={name}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors ${
                          qty > 0
                            ? `${color.bg} ${color.text} border-transparent`
                            : 'bg-slate-800 border-slate-600 text-slate-300'
                        }`}
                      >
                        <span className="text-xs font-semibold">{CHAIN_LABELS[name]}</span>
                        <span className="text-[10px] opacity-70">${price}</span>
                        <button
                          onClick={() => adjustStock(name, -1)}
                          disabled={qty === 0}
                          className="w-5 h-5 rounded bg-black/20 hover:bg-black/40 disabled:opacity-30 font-bold text-xs flex items-center justify-center"
                        >−</button>
                        <span className="w-4 text-center font-bold tabular-nums text-sm">{qty}</span>
                        <button
                          onClick={() => adjustStock(name, +1)}
                          disabled={!canAdd}
                          className="w-5 h-5 rounded bg-black/20 hover:bg-black/40 disabled:opacity-30 font-bold text-xs flex items-center justify-center"
                        >+</button>
                      </div>
                    );
                  })}

                {CHAIN_ORDER.filter(n => publicState.chains[n].isActive && publicState.stockBank[n] > 0).length === 0 && (
                  <span className="text-slate-600 text-sm italic">No stocks available to buy right now.</span>
                )}
              </div>

              {/* Cost preview */}
              {totalStocksToBuy > 0 && (() => {
                const cost = Object.entries(stocksToBuy).reduce((sum, [name, qty]) =>
                  sum + getStockPrice(name, publicState.chains[name].size) * qty, 0);
                const afterCash = (myPlayerInfo?.cash ?? 0) - cost;
                return (
                  <p className="text-xs text-slate-400">
                    Cost: <span className="text-white font-semibold">{formatDollars(cost)}</span>
                    <span className="text-slate-500 ml-2">→ {formatDollars(afterCash)} remaining</span>
                  </p>
                );
              })()}

              {/* End Turn button */}
              <button
                onClick={handleEndTurn}
                disabled={ending}
                className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition-colors"
              >
                {ending
                  ? 'Ending turn…'
                  : totalStocksToBuy > 0
                    ? `Buy ${totalStocksToBuy} share${totalStocksToBuy > 1 ? 's' : ''} & End Turn →`
                    : 'Skip Stocks & End Turn →'
                }
              </button>
            </div>
          )}

          {/* Waiting message (not my turn) */}
          {!isMyTurn && (
            <p className="text-center text-slate-500 text-sm py-1">
              Waiting for <span className="text-slate-300 font-medium">{activePlayer?.name}</span> to play…
              <span className="text-slate-700 ml-2 text-xs">(auto-refreshes every 10s)</span>
            </p>
          )}
        </div>
      </footer>

      {/* ── Chain naming modal (shown when a founding tile is selected) ── */}
      {showNameModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-xl font-bold mb-1">Name Your Chain</h2>
            <p className="text-slate-400 text-sm mb-5">
              Tile <span className="text-white font-mono font-bold">{pendingFoundTile}</span> founds a new hotel.
              Which chain?
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {getAvailableChains(publicState.chains).map(name => {
                const color = CHAIN_COLORS[name];
                return (
                  <button
                    key={name}
                    onClick={() => handleChainChosen(name)}
                    className={`py-3 px-4 rounded-xl font-bold text-sm transition-all hover:scale-105 active:scale-95 ${color.bg} ${color.text}`}
                  >
                    {CHAIN_LABELS[name]}
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleCancelNameModal}
              className="w-full text-slate-400 hover:text-white text-sm underline transition-colors"
            >
              Cancel — pick a different tile
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
