import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { motion, AnimatePresence, useMotionValue, animate, useMotionValueEvent } from 'framer-motion';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import BoardCell, { CHAIN_COLORS } from '../components/Game/Board/BoardCell.jsx';
import { CHAIN_ORDER, CHAIN_LABELS, getStockPrice, formatDollars } from '../utils/gameConstants.js';

// ---- Board geometry ----
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// ---- Client-side tile classification ----
// Mirrors server/game/boardLogic.js — used for UX highlighting only.
// The server performs the authoritative check on every API call.
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
  if (adjLone.length  >  0) {
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

/**
 * For an active chain, returns every player annotated with their bonus rank:
 *   '1st'  — sole majority holder
 *   'tie'  — tied for the most shares (all tied leaders split both bonuses)
 *   '2nd'  — sole second-place holder (or tied for second behind a sole leader)
 *   null   — everyone else
 * Sorted by share count descending; zero-holders included last.
 */
function getRankedHolders(players, chainName) {
  const sorted = [...players]
    .map(p => ({ id: p.id, name: p.name, shares: p.stocks?.[chainName] ?? 0 }))
    .sort((a, b) => b.shares - a.shares);

  if (sorted.length === 0) return sorted;

  const topShares = sorted[0].shares;
  const topTied   = sorted.filter(p => p.shares === topShares && p.shares > 0);

  // If leader is tied, all at the top split both bonuses — no separate 2nd place
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

// Plays a two-note ascending chime via Web Audio API — no audio file needed.
function playTurnChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523, 659].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  } catch (_) { /* browsers may block AudioContext before a user gesture */ }
}

// ============================================================
// AnimatedDollar
// Smoothly counts a dollar value up or down whenever it changes.
// Uses framer-motion's animate() to drive a local display state.
// ============================================================
function AnimatedDollar({ value, className }) {
  const mv      = useMotionValue(value);
  const [display, setDisplay] = useState(value);

  // Subscribe to the motion value and update display state on each frame
  useMotionValueEvent(mv, 'change', (latest) => setDisplay(Math.round(latest)));

  // Whenever the target value changes, animate the motion value to it
  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.55,
      ease: [0.16, 1, 0.3, 1], // expo out — fast start, smooth finish
    });
    return controls.stop;
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return <span className={className}>{formatDollars(display)}</span>;
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

  // ---- Chain naming modal (founding a new chain) ----
  const [pendingFoundTile, setPendingFoundTile] = useState(null);
  const [showNameModal,    setShowNameModal]    = useState(false);

  // ---- Survivor choice modal (tied merger) ----
  const [showSurvivorModal, setShowSurvivorModal] = useState(false);
  const [survivorCandidates, setSurvivorCandidates] = useState([]); // chains to pick from

  // ---- Merger decision inputs ----
  const [mergerSell,  setMergerSell]  = useState(0);
  const [mergerTrade, setMergerTrade] = useState(0);

  // ---- Stock buying ----
  const [stocksToBuy, setStocksToBuy] = useState({});

  // ---- Mobile sidebar toggle ----
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileSidebarTab,  setMobileSidebarTab]  = useState('chains'); // 'chains' | 'standings'

  // Tap active tab → close; tap inactive tab → switch; tap closed → open
  function handleMobileTab(tab) {
    if (mobileSidebarOpen && mobileSidebarTab === tab) {
      setMobileSidebarOpen(false);
    } else {
      setMobileSidebarTab(tab);
      setMobileSidebarOpen(true);
    }
  }

  // ---- Loading / action flags ----
  const [placing,            setPlacing]            = useState(false);
  const [ending,             setEnding]             = useState(false);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [declaringEndGame,   setDeclaringEndGame]   = useState(false);
  const [confirmingRetire,   setConfirmingRetire]   = useState(false);
  const [retiring,           setRetiring]           = useState(false);
  const [restarting,         setRestarting]         = useState(false);
  const [actionError,        setActionError]        = useState('');
  const [logHasNew,          setLogHasNew]          = useState(false);
  const [shakingTile,        setShakingTile]        = useState(null);

  const pollingRef = useRef(null);
  const logRef     = useRef(null);  // bottom-anchor for the game log auto-scroll

  // ── Animation refs ──
  // Track the previous board to detect newly-placed tiles (for tile-drop spring)
  const prevBoardRef    = useRef(null);
  const prevIsMyTurnRef = useRef(false);
  const [justPlacedTiles, setJustPlacedTiles] = useState(new Set());
  // Track previous shareholder ranks to detect new majority holders (for takeover flash)
  const prevRanksRef = useRef({});
  const [flashKeys,  setFlashKeys]  = useState(new Set());

  // ---- Apply any server response to local state ----
  function applyServerResponse(data) {
    setPublicState(data.publicState);
    setMyTiles(data.myTiles);
    setDrawPileCount(data.drawPileCount);
    setPollError('');
    setMergerSell(0);
    setMergerTrade(0);
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

  // Derive poll interval from current game phase:
  //   3 s — merger phases (players are actively waiting for their turn prompt)
  //   4 s — normal active play
  //  10 s — game over or not yet loaded (no urgency)
  const isMergerActive = publicState?.turnPhase === 'MERGER_DECISIONS' || publicState?.turnPhase === 'CHOOSE_SURVIVOR';
  const pollInterval = publicState?.isGameOver
    ? 10_000
    : isMergerActive ? 3_000 : publicState ? 4_000 : 10_000;

  useEffect(() => {
    fetchState();
    pollingRef.current = setInterval(fetchState, pollInterval);
    return () => clearInterval(pollingRef.current);
  }, [fetchState, pollInterval]);

  // Auto-scroll the game log only when already near the bottom; show "↓ New" badge otherwise
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
      setLogHasNew(false);
    } else {
      setLogHasNew(true);
    }
  }, [publicState?.log?.length]);

  // ---- Auto-show the survivor modal when polling reveals CHOOSE_SURVIVOR ----
  useEffect(() => {
    const ctx = publicState?.mergerContext;
    if (
      publicState?.turnPhase === 'CHOOSE_SURVIVOR' &&
      publicState?.players?.[publicState.activePlayerIndex]?.id === user?.id &&
      ctx?.candidateChains?.length > 0 &&
      !showSurvivorModal
    ) {
      setSurvivorCandidates(ctx.candidateChains);
      setShowSurvivorModal(true);
    }
  }, [publicState, user, showSurvivorModal]);

  // ── Effect: detect newly-placed tiles for the tile-drop spring animation ──
  useEffect(() => {
    const board = publicState?.board;
    if (!board) { prevBoardRef.current = null; return; }

    let timer;
    if (prevBoardRef.current) {
      const newlyPlaced = Object.keys(board).filter(
        id => board[id] !== 'empty' && prevBoardRef.current[id] === 'empty'
      );
      if (newlyPlaced.length > 0) {
        setJustPlacedTiles(new Set(newlyPlaced));
        // Clear after spring animation finishes (~700 ms)
        timer = setTimeout(() => setJustPlacedTiles(new Set()), 700);
      }
    }
    prevBoardRef.current = board;
    return () => clearTimeout(timer);
  }, [publicState?.board]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: detect when a player becomes the new sole majority holder ──
  useEffect(() => {
    if (!publicState?.players) return;
    const newFlashes = [];
    for (const chainName of CHAIN_ORDER) {
      if (!publicState.chains[chainName]?.isActive) continue;
      const ranked = getRankedHolders(publicState.players, chainName);
      for (const { id, rank } of ranked) {
        const key  = `${chainName}-${id}`;
        const prev = prevRanksRef.current[key];
        // Flash only when a player *newly* takes sole 1st (not on first load, not if already 1st)
        if (rank === '1st' && prev !== undefined && prev !== '1st') {
          newFlashes.push(key);
        }
        prevRanksRef.current[key] = rank;
      }
    }
    if (newFlashes.length === 0) return;
    setFlashKeys(new Set(newFlashes));
    const timer = setTimeout(() => setFlashKeys(new Set()), 1100);
    return () => clearTimeout(timer);
  }, [publicState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Derived values ----
  const activePlayer      = publicState?.players?.[publicState.activePlayerIndex];
  const isMyTurn          = activePlayer?.id === user?.id;
  const isPlacePhase      = publicState?.turnPhase === 'PLACE_TILE';
  const isBuyPhase        = publicState?.turnPhase === 'BUY_STOCKS';
  const isMergerPhase     = publicState?.turnPhase === 'MERGER_DECISIONS';
  const isChooseSurvivor  = publicState?.turnPhase === 'CHOOSE_SURVIVOR';
  const isGameOver        = publicState?.isGameOver === true;

  const myPlayerInfo = publicState?.players?.find(p => p.id === user?.id);

  // Merger context helpers
  const mergerCtx       = publicState?.mergerContext;
  const currentDefunct  = mergerCtx?.currentDefunct ?? null;
  const survivorChain   = mergerCtx?.survivorChain ?? null;
  const myDefunctShares = currentDefunct ? (myPlayerInfo?.stocks[currentDefunct] ?? 0) : 0;
  // The defunct chain's size is still valid during decisions (zeroed only after advanceMerger)
  const defunctPrice    = currentDefunct
    ? getStockPrice(currentDefunct, publicState?.chains[currentDefunct]?.size ?? 0)
    : 0;
  // Am I first in line to make my merger decision?
  const isMyDecisionTurn = isMergerPhase && mergerCtx?.pendingDecisions?.[0] === user?.id;
  // Name of the player currently deciding (for waiting messages)
  const decidingPlayer = isMergerPhase && mergerCtx?.pendingDecisions?.[0]
    ? publicState?.players?.find(p => p.id === mergerCtx.pendingDecisions[0])
    : null;

  // Computed keep value for merger decision
  const mergerKeep = myDefunctShares - mergerSell - mergerTrade;

  // Pre-classify every tile in hand for highlighting
  const tileClassifications = {};
  if (publicState?.board) {
    for (const tile of myTiles) {
      tileClassifications[tile] = classifyTile(publicState.board, publicState.chains, tile);
    }
  }

  const totalStocksToBuy = Object.values(stocksToBuy).reduce((s, q) => s + q, 0);

  // Update document title and play a chime when it becomes this player's turn
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnRef.current) {
      playTurnChime();
      if (document.hidden) document.title = '⚡ Your Turn! — Mergers';
    } else if (!isMyTurn) {
      document.title = 'Mergers';
    }
    prevIsMyTurnRef.current = isMyTurn;

    function handleVisibility() {
      if (!document.hidden) document.title = 'Mergers';
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isMyTurn]);

  // ============================================================
  // Turn actions
  // ============================================================

  async function handleTileClick(tileId) {
    if (!isMyTurn || !isPlacePhase || placing) return;
    const cls = tileClassifications[tileId];
    if (!cls || cls === 'illegal') {
      if (isMyTurn && isPlacePhase) {
        setShakingTile(tileId);
        setTimeout(() => setShakingTile(null), 350);
      }
      return;
    }
    setActionError('');

    if (cls === 'found') {
      // Need to pick a chain name before submitting
      setPendingFoundTile(tileId);
      setShowNameModal(true);
      return;
    }

    // simple, grow, or merge — submit to server.
    // For merge tiles the server will return needsSurvivorChoice if chains are tied.
    await submitPlayTile(tileId, {});
  }

  async function handleChainChosen(chainName) {
    setShowNameModal(false);
    await submitPlayTile(pendingFoundTile, { chainFounded: chainName });
    setPendingFoundTile(null);
  }

  function handleCancelNameModal() {
    setShowNameModal(false);
    setPendingFoundTile(null);
  }

  async function handleSurvivorChosen(chain) {
    setShowSurvivorModal(false);
    setSurvivorCandidates([]);
    setPlacing(true);
    setActionError('');
    try {
      const data = await api.chooseSurvivor(gameId, chain);
      applyServerResponse(data);
      setStocksToBuy({});
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPlacing(false);
    }
  }

  function handleCancelSurvivorModal() {
    // Cancelling a merger tie-break is not really possible mid-game,
    // but allow closing the modal (polling will reopen it if still needed).
    setShowSurvivorModal(false);
  }

  async function submitPlayTile(tilePlaced, { chainFounded = null, survivorChain: sc = null } = {}) {
    setPlacing(true);
    setActionError('');
    try {
      const body = { tilePlaced };
      if (chainFounded) body.chainFounded = chainFounded;
      if (sc)           body.survivorChain = sc;

      const data = await api.playTile(gameId, body);

      if (data.needsSurvivorChoice) {
        // Tied merger — show the survivor choice modal
        setSurvivorCandidates(data.candidateChains ?? []);
        setShowSurvivorModal(true);
        // Also apply publicState so the board shows the tile as placed
        if (data.publicState) applyServerResponse(data);
        return;
      }

      applyServerResponse(data);
      setStocksToBuy({});
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPlacing(false);
    }
  }

  // ---- Merger decision ----
  function adjustMergerSell(delta) {
    const next = mergerSell + delta;
    if (next < 0 || next + mergerTrade > myDefunctShares) return;
    setMergerSell(next);
  }

  function adjustMergerTrade(delta) {
    const next = mergerTrade + delta;
    if (next < 0 || next % 2 !== 0) return; // must be even
    if (mergerSell + next > myDefunctShares) return;
    // Also check bank has enough survivor shares
    if (delta > 0 && (publicState?.stockBank[survivorChain] ?? 0) < (next / 2)) return;
    setMergerTrade(next);
  }

  async function handleMergerDecision() {
    if (mergerKeep < 0) {
      setActionError('Sell + Trade cannot exceed your total shares held');
      return;
    }
    setSubmittingDecision(true);
    setActionError('');
    try {
      const data = await api.mergerDecision(gameId, { sell: mergerSell, trade: mergerTrade });
      applyServerResponse(data);
      setStocksToBuy({});
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmittingDecision(false);
    }
  }

  // ---- Stock quantity adjustment ----
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

  // ---- End turn ----
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

  // ---- Declare end game ----
  async function handleDeclareEndGame() {
    if (!window.confirm(
      'Declare the game over?\n\nFinal shareholder bonuses will be paid, all stocks liquidated, and the winner announced.'
    )) return;
    setDeclaringEndGame(true);
    setActionError('');
    try {
      const data = await api.declareEndGame(gameId);
      applyServerResponse(data);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setDeclaringEndGame(false);
    }
  }

  // ---- Play Again ----
  async function handleRestart() {
    setRestarting(true);
    try {
      const data = await api.restartGame(gameId);
      applyServerResponse(data);
    } catch (err) {
      // Surface the error on the game-over screen via actionError
      setActionError(err.message);
    } finally {
      setRestarting(false);
    }
  }

  // ---- Retire ----
  async function handleRetire() {
    setRetiring(true);
    setConfirmingRetire(false);
    setActionError('');
    try {
      const data = await api.retire(gameId);
      applyServerResponse(data);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setRetiring(false);
    }
  }

  // ============================================================
  // Loading / error screens
  // ============================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-slate-200 flex items-center justify-center">
        <p className="text-slate-500 text-sm">Loading game…</p>
      </div>
    );
  }

  if (!publicState) {
    return (
      <div className="min-h-screen bg-black text-slate-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{pollError || 'Game state not found.'}</p>
          <button onClick={navigate.toDashboard} className="text-blue-400 underline text-sm">
            ← Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // Game over screen
  // ============================================================

  if (isGameOver) {
    const winner   = publicState.players.find(p => p.id === publicState.winner);
    const standings = [...publicState.players].sort((a, b) => b.cash - a.cash);
    return (
      <div className="min-h-screen bg-black text-slate-200 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-md">
          <h1 className="text-4xl font-display neon-text text-cyan-400 text-center mb-1">Game Over!</h1>
          <p className="text-center text-yellow-400 font-semibold text-lg mb-8">
            🏆 {winner?.name ?? 'Someone'} wins!
          </p>

          <div className="bg-slate-900 rounded-2xl overflow-hidden mb-6 border border-slate-800">
            <div className="px-4 py-2 bg-slate-800 text-xs uppercase tracking-wider text-slate-400 font-display">
              Final Standings
            </div>
            {standings.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 last:border-0 ${
                  p.id === publicState.winner ? 'bg-yellow-900/20' : ''
                }`}
              >
                <span className="text-slate-500 font-mono w-6 text-right">#{i + 1}</span>
                <span className={`flex-1 font-semibold ${p.id === publicState.winner ? 'text-yellow-300' : 'text-white'}`}>
                  {p.name}
                  {p.id === user?.id && <span className="text-slate-500 text-xs ml-2">(you)</span>}
                </span>
                <span className="tabular-nums font-bold text-slate-200">{formatDollars(p.cash)}</span>
              </div>
            ))}
          </div>

          {/* Recent log — shows payout details */}
          {publicState.log?.length > 0 && (
            <div className="bg-slate-800/50 rounded-xl p-4 mb-6 max-h-48 overflow-y-auto">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Game Log</p>
              <ul className="space-y-1">
                {publicState.log.slice(0, 20).map((e, i) => (
                  <li key={i} className="text-[11px] text-slate-400">{e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {actionError && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg px-3 py-2 mb-4">
              {actionError}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors neon-glow-green"
            >
              {restarting ? 'Starting new game…' : 'Play Again'}
            </button>
            <button
              onClick={navigate.toDashboard}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-3 rounded-xl transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // Main game render
  // ============================================================

  return (
    <div className="min-h-screen bg-black text-slate-200 flex flex-col">

      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-black/95 sticky top-0 z-20 gap-4">
        <button
          onClick={navigate.toDashboard}
          className="text-slate-400 hover:text-white text-sm transition-colors flex-shrink-0"
        >
          ← Dashboard
        </button>

        {/* Turn / phase indicator */}
        <div className="text-center flex-1 text-sm font-semibold">
          {isMergerPhase && (
            <span className="text-orange-400">
              ⚔ Merger — {survivorChain} absorbs {currentDefunct}
              {mergerCtx?.defunctQueue?.length > 0 ? ` (+${mergerCtx.defunctQueue.length} more)` : ''}
            </span>
          )}
          {isChooseSurvivor && isMyTurn && (
            <span className="text-yellow-400">⚔ Tied merger — choose the surviving chain</span>
          )}
          {isChooseSurvivor && !isMyTurn && (
            <span className="text-slate-400">
              Waiting for <span className="text-white">{activePlayer?.name}</span> to choose the survivor
            </span>
          )}
          {!isMergerPhase && !isChooseSurvivor && isMyTurn && (
            isPlacePhase
              ? <span className="text-green-400">Your turn — place a tile</span>
              : <span className="text-yellow-400">Your turn — buy stocks &amp; end turn</span>
          )}
          {!isMergerPhase && !isChooseSurvivor && !isMyTurn && (
            <span className="text-slate-400">
              Waiting for <span className="text-white font-medium">{activePlayer?.name}</span>
            </span>
          )}
        </div>

        <div className="text-slate-500 text-xs flex-shrink-0">
          Turn {publicState.turnNumber} · {drawPileCount} tiles left
        </div>
      </header>

      {/* ── Body: board + sidebar ── */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">

        {/* ── Board ── */}
        <main className="flex-1 flex flex-col p-2 sm:p-4 overflow-auto">

          {pollError && (
            <p className="text-amber-400 text-xs text-center mb-2">⚠ {pollError} — retrying…</p>
          )}

          <div className="w-full max-w-4xl mx-auto overflow-x-auto">
            <div className="grid grid-cols-[1.5rem_repeat(12,1fr)] gap-0.5 sm:gap-1">

              <div />
              {COLS.map(col => (
                <div key={col} className="text-center text-[clamp(0.4rem,1.2vw,0.65rem)] text-slate-500 font-mono pb-0.5">
                  {col}
                </div>
              ))}

              {ROWS.flatMap(row => [
                <div
                  key={`lbl-${row}`}
                  className="text-[clamp(0.4rem,1.2vw,0.65rem)] text-slate-500 font-mono flex items-center justify-end pr-0.5"
                >
                  {row}
                </div>,

                ...COLS.map(col => {
                  const tileId    = `${col}${row}`;
                  const cls       = tileClassifications[tileId];
                  const inHand    = myTiles.includes(tileId);
                  // Merge tiles are now clickable (triggers a merger)
                  const clickable = isMyTurn && isPlacePhase && !placing
                    && inHand && cls !== 'illegal';

                  const isNew     = justPlacedTiles.has(tileId);
                  const isShaking = shakingTile === tileId;
                  return (
                    // motion.div is the grid item; scale animation is purely visual (no layout shift)
                    <motion.div
                      key={tileId}
                      animate={isShaking ? { x: [0, -5, 5, -5, 5, 0] } : isNew ? { scale: [1.45, 1] } : {}}
                      transition={isShaking
                        ? { duration: 0.35, ease: 'easeInOut' }
                        : { type: 'spring', stiffness: 380, damping: 14 }}
                      style={{ zIndex: isNew ? 10 : undefined, position: 'relative' }}
                    >
                      <BoardCell
                        tileId={tileId}
                        cellState={publicState.board[tileId]}
                        isInHand={inHand}
                        isLegal={clickable}
                        isMyTurn={isMyTurn}
                        isPlacePhase={isPlacePhase}
                        onClick={() => handleTileClick(tileId)}
                      />
                    </motion.div>
                  );
                }),
              ])}
            </div>
          </div>

          {/* Game log — scrollable; "↓ New" badge shows when scrolled away from bottom */}
          {publicState.log?.length > 0 && (
            <div className="w-full max-w-4xl mx-auto mt-4 px-1">
              <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Game Log</p>
              <div className="relative">
                <div
                  ref={logRef}
                  className="max-h-36 overflow-y-auto space-y-0.5 pr-1"
                  onScroll={() => {
                    const el = logRef.current;
                    if (!el) return;
                    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) setLogHasNew(false);
                  }}
                >
                  {publicState.log.map((entry, i) => (
                    <p key={i} className="text-[11px] text-slate-500">{entry.message}</p>
                  ))}
                </div>
                {logHasNew && (
                  <button
                    onClick={() => {
                      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
                      setLogHasNew(false);
                    }}
                    className="absolute bottom-0 right-1 text-[10px] text-cyan-400 bg-slate-900 border border-cyan-800 rounded px-1.5 py-0.5"
                  >
                    ↓ New
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Mobile-only info toggle — hidden on lg+ where the sidebar is always visible */}
          <div className="lg:hidden w-full max-w-4xl mx-auto mt-3 flex gap-2">
            <button
              onClick={() => handleMobileTab('chains')}
              className={`flex-1 py-1.5 text-xs border rounded-lg transition-colors
                ${mobileSidebarOpen && mobileSidebarTab === 'chains'
                  ? 'border-cyan-700 text-cyan-400 bg-cyan-900/20'
                  : 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'}`}
            >
              {mobileSidebarOpen && mobileSidebarTab === 'chains' ? '▲ Chains' : '▼ Chains'}
            </button>
            <button
              onClick={() => handleMobileTab('standings')}
              className={`flex-1 py-1.5 text-xs border rounded-lg transition-colors
                ${mobileSidebarOpen && mobileSidebarTab === 'standings'
                  ? 'border-cyan-700 text-cyan-400 bg-cyan-900/20'
                  : 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'}`}
            >
              {mobileSidebarOpen && mobileSidebarTab === 'standings' ? '▲ Standings' : '▼ Standings'}
            </button>
          </div>
        </main>

        {/* ── Sidebar ── */}
        {/* Mobile: hidden by default, toggled via the Chains/Standings buttons above the footer */}
        {/* Desktop (lg+): always visible as a fixed-width side panel */}
        <aside className={`lg:w-72 xl:w-80 border-t lg:border-t-0 lg:border-l border-slate-800 overflow-y-auto flex-shrink-0
          ${mobileSidebarOpen ? 'block' : 'hidden'} lg:block`}>

          {/* Mobile-only tab bar — lets the player switch between Chains and Standings */}
          <div className="flex lg:hidden border-b border-slate-800">
            <button
              onClick={() => setMobileSidebarTab('chains')}
              className={`flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors
                ${mobileSidebarTab === 'chains'
                  ? 'text-cyan-400 border-b-2 border-cyan-400'
                  : 'text-slate-500 hover:text-slate-300'}`}
            >
              Chains
            </button>
            <button
              onClick={() => setMobileSidebarTab('standings')}
              className={`flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors
                ${mobileSidebarTab === 'standings'
                  ? 'text-cyan-400 border-b-2 border-cyan-400'
                  : 'text-slate-500 hover:text-slate-300'}`}
            >
              Standings
            </button>
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="px-3 text-slate-500 hover:text-white text-sm"
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* Hotel chain table */}
          {/* On mobile: only shown when Chains tab is active */}
          <section className={`p-3 border-b border-slate-800 ${mobileSidebarTab !== 'chains' ? 'hidden lg:block' : ''}`}>
            <h2 className="text-[10px] uppercase tracking-widest text-slate-500 font-display mb-2">
              Hotel Chains
            </h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-slate-500 border-b border-slate-700">
                  <th className="py-1 text-left">Chain</th>
                  <th className="py-1 text-right" title="Tiles in chain">Size</th>
                  <th className="py-1 text-right" title="Stock price per share">$/sh</th>
                  <th className="py-1 text-right" title="Shares in bank">Bank</th>
                </tr>
              </thead>
              <tbody>
                {CHAIN_ORDER.map(name => {
                  const chain      = publicState.chains[name];
                  const color      = CHAIN_COLORS[name];
                  const price      = getStockPrice(name, chain.size);
                  const bank       = publicState.stockBank[name];
                  const isDefunct  = name === currentDefunct;
                  const isSurvivor = name === survivorChain && isMergerPhase;

                  // Inactive chains: simple dimmed single row, no shareholder detail
                  if (!chain.isActive && !isDefunct) {
                    return (
                      <tr key={name} className="border-b border-slate-700/30 last:border-0 opacity-30">
                        <td className="py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-sm flex-shrink-0 bg-slate-600" />
                            <span className="text-slate-500">{CHAIN_LABELS[name]}</span>
                          </div>
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">—</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">—</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">{bank}</td>
                      </tr>
                    );
                  }

                  // Active (or defunct during merger): main info row + per-player holdings row
                  const ranked = getRankedHolders(publicState.players, name);
                  return (
                    <Fragment key={name}>
                      {/* Main chain info row — colored left border acts as a neon stripe */}
                      <tr className={`border-b border-slate-800/50 ${isDefunct ? 'bg-red-900/20' : ''} ${isSurvivor ? 'bg-green-900/10' : ''}`}>
                        <td className={`pl-2 pt-2 pb-1 border-l-2 ${color.border}`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${color.bg}`} />
                            <span className="text-white font-medium">{CHAIN_LABELS[name]}</span>
                            {chain.isSafe  && <span className="text-red-400 text-[8px]">🔒</span>}
                            {isDefunct     && <span className="text-red-400 text-[8px] ml-0.5">defunct</span>}
                            {isSurvivor    && <span className="text-green-400 text-[8px] ml-0.5">survivor</span>}
                          </div>
                        </td>
                        <td className={`pt-2 pb-1 text-right tabular-nums font-medium ${chain.isSafe ? 'text-red-400' : 'text-slate-300'}`}>
                          {chain.size}
                        </td>
                        <td className="pt-2 pb-1 text-right tabular-nums text-slate-300">
                          ${price}
                        </td>
                        <td className="pt-2 pb-1 text-right tabular-nums text-slate-500">
                          {bank}
                        </td>
                      </tr>

                      {/* Per-player shareholder row */}
                      <tr className="border-b border-slate-700/50 last:border-0">
                        <td colSpan={4} className="pb-2 pt-0">
                          {ranked.every(p => p.shares === 0) ? (
                            <span className="text-[10px] text-slate-600 italic">No shares held</span>
                          ) : (
                            // motion.div so the container itself can FLIP when its size changes
                            <motion.div layout className="flex flex-wrap gap-1">
                              {/* initial={false} prevents entrance animation on first page load */}
                              <AnimatePresence initial={false} mode="popLayout">
                                {ranked.map(({ id, name: pName, shares, rank }) => {
                                  const isMe       = id === user?.id;
                                  const flashKey   = `${name}-${id}`;
                                  const isFlashing = flashKeys.has(flashKey);
                                  const badge =
                                    rank === '1st' ? <span className="text-yellow-400 font-bold ml-0.5">1st</span> :
                                    rank === 'tie' ? <span className="text-yellow-500 ml-0.5">tie</span> :
                                    rank === '2nd' ? <span className="text-slate-400 ml-0.5">2nd</span> :
                                    null;
                                  return (
                                    <motion.span
                                      key={id}
                                      layout
                                      initial={{ opacity: 0, scale: 0.75 }}
                                      animate={{ opacity: shares === 0 ? 0.4 : 1, scale: 1 }}
                                      exit={{ opacity: 0, scale: 0.75 }}
                                      transition={{
                                        layout: { type: 'spring', stiffness: 350, damping: 30 },
                                        opacity: { duration: 0.2 },
                                        scale:   { type: 'spring', stiffness: 300, damping: 25 },
                                      }}
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px]
                                        ${isMe
                                          ? 'bg-cyan-900/60 border border-cyan-700'
                                          : 'bg-slate-800/60 border border-slate-700'}
                                        ${isFlashing ? 'badge-flash-first' : ''}`}
                                    >
                                      <span className={isMe ? 'text-cyan-200' : 'text-slate-300'}>{pName}</span>
                                      <span className="tabular-nums font-bold text-white ml-1">{shares}</span>
                                      {badge}
                                    </motion.span>
                                  );
                                })}
                              </AnimatePresence>
                            </motion.div>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-1.5 text-[9px] text-slate-600 space-y-0.5">
              <div>
                <span className="text-yellow-400 font-bold">1st</span> = majority bonus &nbsp;
                <span className="text-slate-400">2nd</span> = minority bonus &nbsp;
                <span className="text-yellow-500">tie</span> = split both bonuses
              </div>
              <div>🔒 Safe = 11+ tiles (cannot be merged)</div>
            </div>
          </section>

          {/* Player standings */}
          {/* On mobile: only shown when Standings tab is active */}
          <section className={`p-3 ${mobileSidebarTab !== 'standings' ? 'hidden lg:block' : ''}`}>
            <h2 className="text-[10px] uppercase tracking-widest text-slate-500 font-display mb-2">
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
                        isActive ? 'border-cyan-500 bg-cyan-900/20' : 'border-transparent bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] text-slate-500 font-mono w-4 text-right">#{rank + 1}</span>
                        <span className={`text-sm font-semibold flex-1 truncate ${p.isRetired ? 'line-through text-slate-500' : 'text-white'}`}>
                          {p.name}
                        </span>
                        {isMe     && <span className="text-[9px] text-slate-500">(you)</span>}
                        {isActive && !isMe && <span className="text-[9px] text-cyan-400">▶</span>}
                      </div>
                      <div className="ml-5 flex justify-between text-[11px]">
                        <span className="text-slate-500">
                          Cash: <AnimatedDollar value={p.cash} className="text-slate-300 tabular-nums" />
                        </span>
                        <AnimatedDollar value={net} className="text-slate-200 font-bold tabular-nums" />
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        </aside>
      </div>

      {/* ── Footer: varies by game phase ── */}
      <footer className="sticky bottom-0 z-10 bg-black/95 backdrop-blur-sm border-t border-slate-800">

        {/* Error banner */}
        {actionError && (
          <div className="px-4 pt-2">
            <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded-lg px-3 py-2">
              {actionError}
            </div>
          </div>
        )}

        <div className="px-4 py-3 space-y-3">

          {/* ── MERGER DECISIONS phase — drops in from above with orange glow ── */}
          <AnimatePresence>
            {isMergerPhase && (
              <motion.div
                key="merger-panel"
                initial={{ y: -40, opacity: 0 }}
                animate={{
                  y: 0,
                  opacity: 1,
                  boxShadow: '0 0 24px rgba(249,115,22,0.45), 0 0 48px rgba(249,115,22,0.15)',
                }}
                exit={{ y: -20, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              >
                {isMyDecisionTurn ? (
                  <div className="space-y-2">
                    <div className="bg-orange-900/30 border border-orange-700/50 rounded-xl p-3">
                      <p className="text-orange-300 font-semibold text-sm mb-0.5">
                        ⚔ Merger Decision — {CHAIN_LABELS[currentDefunct] ?? currentDefunct}
                      </p>
                      <p className="text-slate-400 text-xs">
                        You hold <span className="text-white font-bold">{myDefunctShares}</span> shares
                        worth <span className="text-white font-bold">${defunctPrice}</span> each.
                      </p>
                      {survivorChain && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-slate-500 text-xs">surviving as</span>
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${CHAIN_COLORS[survivorChain]?.border ?? ''} ${CHAIN_COLORS[survivorChain]?.text ?? 'text-white'}`}>
                            <span className={`w-2 h-2 rounded-sm ${CHAIN_COLORS[survivorChain]?.bg ?? ''}`} />
                            {CHAIN_LABELS[survivorChain] ?? survivorChain}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3 flex-wrap">
                      {/* Sell control */}
                      <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5">
                        <span className="text-xs text-slate-400 font-medium">Sell</span>
                        <button onClick={() => adjustMergerSell(-1)} disabled={mergerSell <= 0}
                          className="w-5 h-5 rounded bg-black/30 hover:bg-black/50 disabled:opacity-30 font-bold text-xs flex items-center justify-center">−</button>
                        <span className="w-6 text-center font-bold tabular-nums text-sm text-red-300">{mergerSell}</span>
                        <button onClick={() => adjustMergerSell(+1)} disabled={mergerSell + mergerTrade >= myDefunctShares}
                          className="w-5 h-5 rounded bg-black/30 hover:bg-black/50 disabled:opacity-30 font-bold text-xs flex items-center justify-center">+</button>
                        {mergerSell > 0 && (
                          <span className="text-[10px] text-green-400 ml-1">+{formatDollars(mergerSell * defunctPrice)}</span>
                        )}
                      </div>

                      {/* Trade control (2-for-1) */}
                      <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-1.5">
                        <span className="text-xs text-slate-400 font-medium">Trade</span>
                        <button onClick={() => adjustMergerTrade(-2)} disabled={mergerTrade <= 0}
                          className="w-5 h-5 rounded bg-black/30 hover:bg-black/50 disabled:opacity-30 font-bold text-xs flex items-center justify-center">−</button>
                        <span className="w-6 text-center font-bold tabular-nums text-sm text-blue-300">{mergerTrade}</span>
                        <button onClick={() => adjustMergerTrade(+2)} disabled={mergerSell + mergerTrade >= myDefunctShares}
                          className="w-5 h-5 rounded bg-black/30 hover:bg-black/50 disabled:opacity-30 font-bold text-xs flex items-center justify-center">+</button>
                        {mergerTrade > 0 && (
                          <span className="text-[10px] text-blue-400 ml-1">→ {mergerTrade / 2} {CHAIN_LABELS[survivorChain]}</span>
                        )}
                      </div>

                      {/* Keep (auto-computed) */}
                      <div className="flex items-center gap-1.5 bg-slate-800/50 border border-slate-700 rounded-lg px-2.5 py-1.5">
                        <span className="text-xs text-slate-500 font-medium">Keep</span>
                        <span className={`font-bold text-sm tabular-nums ${mergerKeep < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {mergerKeep}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={handleMergerDecision}
                      disabled={submittingDecision || mergerKeep < 0}
                      className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition-colors neon-glow-orange-ui"
                    >
                      {submittingDecision ? 'Submitting…' : 'Confirm Decision →'}
                    </button>
                  </div>
                ) : (
                  <p className="text-center text-slate-500 text-sm py-1">
                    ⚔ Merger in progress — waiting for{' '}
                    <span className="text-orange-300 font-medium">{decidingPlayer?.name ?? '…'}</span>{' '}
                    to decide on their <span className="text-white">{CHAIN_LABELS[currentDefunct] ?? currentDefunct}</span> shares.
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Normal phases: tile hand + buy stocks + end turn */}
          {!isMergerPhase && !isChooseSurvivor && (
            <>
              {/* ── Tile hand (PLACE_TILE phase or spectating) ── */}
              {(isPlacePhase || !isMyTurn) && (
                <div className="flex flex-col gap-2">
                  <span className="text-slate-500 text-xs uppercase tracking-wider">
                    {isMyTurn && isPlacePhase ? 'Your turn — place a tile:' : 'Your tiles:'}
                  </span>

                  {myTiles.length === 0 && (
                    <span className="text-slate-600 text-sm italic">No tiles in hand</span>
                  )}

                  {/* 3-column grid on mobile → flex row on sm+ screens */}
                  <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                  {myTiles.map(tileId => {
                    const cls       = tileClassifications[tileId];
                    const canPlace  = isMyTurn && isPlacePhase && !placing && cls !== 'illegal';
                    const isIllegal = isMyTurn && isPlacePhase && cls === 'illegal';
                    const isMerge   = cls === 'merge';

                    return (
                      <button
                        key={tileId}
                        onClick={() => handleTileClick(tileId)}
                        disabled={!canPlace || placing}
                        title={
                          isIllegal ? `${tileId} — cannot be played (illegal)` :
                          isMerge   ? `${tileId} — triggers a merger` :
                          tileId
                        }
                        className={`
                          px-3 py-2 rounded-lg font-mono font-bold text-sm border-2 transition-all touch-manipulation
                          ${canPlace && isMerge
                            ? 'bg-orange-600 border-orange-400 text-white hover:bg-orange-500 active:scale-95 cursor-pointer neon-glow-orange'
                            : canPlace
                              ? 'bg-cyan-600 border-cyan-400 text-black hover:bg-cyan-500 active:scale-95 cursor-pointer neon-glow-cyan'
                              : isIllegal
                                ? 'bg-slate-800 border-slate-700 text-slate-600 opacity-40 cursor-not-allowed'
                                : 'bg-slate-700 border-slate-600 text-slate-300 cursor-default'
                          }
                        `}
                      >
                        {placing ? '…' : tileId}
                      </button>
                    );
                  })}
                  </div>{/* end grid/flex tile row */}
                </div>
              )}

              {/* ── Retire option (PLACE_TILE phase, my turn only) ── */}
              {isMyTurn && isPlacePhase && (
                <div className="flex justify-end">
                  {confirmingRetire ? (
                    // Confirmation card — two-step so the player can't retire by accident
                    <div className="flex items-center gap-2 bg-red-950/60 border border-red-700/60 rounded-lg px-3 py-2">
                      <span className="text-red-300 text-xs font-medium">
                        Retire permanently? Your tiles are discarded.
                      </span>
                      <button
                        onClick={handleRetire}
                        disabled={retiring}
                        className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold px-2.5 py-1 rounded transition-colors"
                      >
                        {retiring ? 'Retiring…' : 'Yes, retire'}
                      </button>
                      <button
                        onClick={() => setConfirmingRetire(false)}
                        className="text-slate-400 hover:text-white text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingRetire(true)}
                      className="text-slate-600 hover:text-red-400 text-xs transition-colors underline underline-offset-2"
                    >
                      Retire from game
                    </button>
                  )}
                </div>
              )}

              {/* ── Buy stocks + End Turn (BUY_STOCKS phase) ── */}
              {isMyTurn && isBuyPhase && (
                <div className="space-y-2">

                  {/* End-game available banner */}
                  {publicState.endGameAvailable && (
                    <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                      <p className="text-yellow-300 text-xs font-medium">
                        🏁 End game available — {publicState.endGameReason}
                      </p>
                      <button
                        onClick={handleDeclareEndGame}
                        disabled={declaringEndGame}
                        className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                      >
                        {declaringEndGame ? 'Ending…' : 'End Game'}
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs uppercase tracking-wider">
                      Buy stocks (optional, max 3)
                    </span>
                    <span className="text-slate-500 text-xs tabular-nums">{totalStocksToBuy}/3</span>
                  </div>

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
                            <button onClick={() => adjustStock(name, -1)} disabled={qty === 0}
                              className="w-5 h-5 rounded bg-black/20 hover:bg-black/40 disabled:opacity-30 font-bold text-xs flex items-center justify-center">−</button>
                            <span className="w-4 text-center font-bold tabular-nums text-sm">{qty}</span>
                            <button onClick={() => adjustStock(name, +1)} disabled={!canAdd}
                              className="w-5 h-5 rounded bg-black/20 hover:bg-black/40 disabled:opacity-30 font-bold text-xs flex items-center justify-center">+</button>
                          </div>
                        );
                      })}

                    {CHAIN_ORDER.filter(n => publicState.chains[n].isActive && publicState.stockBank[n] > 0).length === 0 && (
                      <span className="text-slate-600 text-sm italic">No stocks available to buy.</span>
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

                  <button
                    onClick={handleEndTurn}
                    disabled={ending}
                    className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition-colors neon-glow-green"
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
            </>
          )}

          {/* CHOOSE_SURVIVOR: show waiting message in footer too */}
          {isChooseSurvivor && (
            <p className="text-center text-orange-400 text-sm py-1 font-medium">
              {isMyTurn ? '⚔ Choose the surviving chain above…' : `Waiting for ${activePlayer?.name} to choose the surviving chain…`}
            </p>
          )}
        </div>
      </footer>

      {/* ── Chain naming modal (founding a new hotel) ── */}
      {showNameModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-xl font-display mb-1">Name Your Chain</h2>
            <p className="text-slate-400 text-sm mb-5">
              Tile <span className="text-white font-mono font-bold">{pendingFoundTile}</span> founds a new hotel. Which chain?
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
            <button onClick={handleCancelNameModal} className="w-full text-slate-400 hover:text-white text-sm underline transition-colors">
              Cancel — pick a different tile
            </button>
          </div>
        </div>
      )}

      {/* ── Survivor choice modal (tied merger) ── */}
      {showSurvivorModal && survivorCandidates.length > 0 && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-orange-600/60 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-xl font-display mb-1">⚔ Tied Merger!</h2>
            <p className="text-slate-400 text-sm mb-5">
              These chains are the same size. Choose which one <span className="text-white font-semibold">survives</span>.
              The others will be absorbed.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {survivorCandidates.map(name => {
                const color = CHAIN_COLORS[name];
                const size  = publicState.chains[name]?.size ?? 0;
                return (
                  <button
                    key={name}
                    onClick={() => handleSurvivorChosen(name)}
                    className={`py-3 px-4 rounded-xl font-bold text-sm transition-all hover:scale-105 active:scale-95 ${color.bg} ${color.text} flex flex-col items-center`}
                  >
                    <span>{CHAIN_LABELS[name]}</span>
                    <span className="text-[10px] opacity-70 font-normal mt-0.5">{size} tiles</span>
                  </button>
                );
              })}
            </div>
            <button onClick={handleCancelSurvivorModal} className="w-full text-slate-400 hover:text-white text-sm underline transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
