import { getRoom } from '../rooms/roomManager.js';
import { getPublicGameState, checkEndGameConditions, resetGameState } from '../game/GameState.js';
import { classifyPlacement, isLegalPlacement, findUnplayableTiles, getAdjacentChains } from '../game/boardLogic.js';
import { drawTiles } from '../game/tileLogic.js';
import { foundChain, growChain } from '../game/chainLogic.js';
import { validatePurchase, applyPurchase, getStockPrice } from '../game/stockLogic.js';
import {
  initiateMerger, applySurvivorChoice, advanceMerger,
  validateMergerDecision, applyMergerDecision,
  executeEndGamePayouts,
} from '../game/mergerLogic.js';

// ---- Helpers ----

/**
 * Deep-clone any plain-JS object/array tree using JSON serialization.
 * Safe for our game state because it contains only strings, numbers,
 * booleans, plain objects, and arrays (no Sets, Maps, or functions).
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Snapshot the current turn state onto the room object.
 * Called at the START of each player's turn (PLACE_TILE), before they act.
 * The snapshot is used to restore state if the player triggers an undo.
 */
function snapshotTurn(room) {
  room.turnSnapshot = {
    gameState:   deepClone(room.gameState),
    playerTiles: deepClone(room.playerTiles),
  };
}

/**
 * Given the chains adjacent to a newly-placed merger tile, work out
 * which chain would survive and which would be acquired — without
 * actually mutating any game state.
 *
 * Returns a `pendingMerger` object that is stored on `gameState` during
 * the CONFIRM_MERGER phase so the client can show a confirmation dialog.
 *
 * @param {object} gs       — current game state (read-only here)
 * @param {string} tileId   — the tile that triggered the merger
 * @param {string[]} adjChains — chain names adjacent to that tile
 */
function computePendingMerger(gs, tileId, adjChains) {
  // Sort chains largest-first to identify the natural survivor
  const sorted = [...adjChains].sort((a, b) => gs.chains[b].size - gs.chains[a].size);

  // A tie exists when the top two chains share the same size
  const isTie = sorted.length >= 2 && gs.chains[sorted[0]].size === gs.chains[sorted[1]].size;

  return {
    tileId,                                                      // needed for confirmMerger
    adjChains,                                                   // needed for confirmMerger
    survivorName: isTie ? null : sorted[0],                      // null if player must choose
    defunctNames: isTie ? sorted : sorted.slice(1),              // chains being acquired
    isTie,
  };
}

/**
 * Broadcast the public game state to all players in the room,
 * then send each player their private tile hand individually.
 * Called after every state change.
 */
export function broadcastGameState(io, room) {
  const publicState = getPublicGameState(room.gameState);
  io.to(room.code).emit('game:stateUpdate', publicState);

  for (const player of room.gameState.players) {
    const tiles      = room.playerTiles[player.id] ?? [];
    const roomPlayer = room.players.find(p => p.id === player.id);
    if (roomPlayer?.socketId) {
      io.to(roomPlayer.socketId).emit('game:tilesUpdate', tiles);
    }
  }
}

/** Append a line to the game log (capped at 100 entries). */
function addLog(gameState, message) {
  gameState.log.push({ time: Date.now(), message });
  if (gameState.log.length > 100) gameState.log.shift();
}

/**
 * Check end-game conditions and, if met for the first time, flag them in state.
 * Called whenever a tile placement fully resolves and we're entering BUY_STOCKS.
 */
function checkAndFlagEndGame(gs) {
  if (gs.endGameAvailable) return; // already flagged — don't overwrite
  const { canEnd, reason } = checkEndGameConditions(gs);
  if (canEnd) {
    gs.endGameAvailable = true;
    gs.endGameReason    = reason;
    addLog(gs, `End-game condition met: ${reason} The active player may declare the game over.`);
  }
}

/** Advance to the next non-retired player and increment the turn counter. */
function advanceToNextPlayer(gameState) {
  const { players } = gameState;
  let next  = (gameState.activePlayerIndex + 1) % players.length;
  let tries = 0;
  while (players[next].isRetired && tries < players.length) {
    next = (next + 1) % players.length;
    tries++;
  }
  gameState.activePlayerIndex = next;
  gameState.turnNumber++;
}

// ---- Handler registration ----

export function registerGameHandlers(io, socket) {

  /**
   * game:placeTile
   * Active player places one of their tiles on the board.
   *
   * Placement types and what happens:
   *   'simple' → lone tile, no neighbors      → advance to BUY_STOCKS
   *   'found'  → touches 1+ lone tiles        → enter NAME_CHAIN phase
   *   'grow'   → touches exactly 1 chain      → grow chain, advance to BUY_STOCKS
   *   'merge'  → touches 2+ chains            → Phase 4 (stubbed for now)
   */
  socket.on('game:placeTile', ({ playerId, roomCode, tileId }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs           = room.gameState;
    const activePlayer = gs.players[gs.activePlayerIndex];

    // --- Validation ---
    if (activePlayer.id !== playerId) {
      socket.emit('error', { message: "It's not your turn." }); return;
    }
    if (gs.turnPhase !== 'PLACE_TILE') {
      socket.emit('error', { message: 'You cannot place a tile right now.' }); return;
    }
    const hand = room.playerTiles[playerId] ?? [];
    if (!hand.includes(tileId)) {
      socket.emit('error', { message: "You don't have that tile." }); return;
    }
    if (!isLegalPlacement(gs, tileId)) {
      socket.emit('error', { message: 'That tile cannot be played right now.' }); return;
    }

    // --- Take a snapshot of the clean turn state before the player acts ---
    // This is the restore point for the undo feature.
    // If a snapshot doesn't exist yet (first turn of the game), create it now.
    if (!room.turnSnapshot) snapshotTurn(room);

    // --- Apply the move ---
    room.playerTiles[playerId] = hand.filter(t => t !== tileId);
    const placementType = classifyPlacement(gs, tileId);
    gs.board[tileId] = 'lone'; // always start as lone; chain logic may immediately reassign

    // Flag that the active player has now acted — enables the Undo button
    gs.hasActedThisTurn = true;

    addLog(gs, `${activePlayer.name} placed tile ${tileId}.`);

    if (placementType === 'simple') {
      // Isolated tile — nothing extra to do
      gs.turnPhase = 'BUY_STOCKS';

    } else if (placementType === 'found') {
      // The placed tile connects to one or more lone tiles — a new chain must be named.
      // Store the founding tile so game:nameChain can flood-fill from it.
      gs.pendingFoundTileId = tileId;
      gs.turnPhase = 'NAME_CHAIN';
      // All players will see the NAME_CHAIN phase in the state broadcast.
      // Only the active player's client shows the chain-selection dialog.

    } else if (placementType === 'grow') {
      // The placed tile extends an existing chain (and possibly absorbs nearby lone tiles).
      const [chainName] = getAdjacentChains(gs.board, tileId); // exactly 1 chain adjacent
      const tilesAdded  = growChain(gs, tileId, chainName);
      addLog(gs, `${chainName} grew by ${tilesAdded} tile(s) (now ${gs.chains[chainName].size}).`);
      if (gs.chains[chainName].isSafe) {
        addLog(gs, `${chainName} is now SAFE (${gs.chains[chainName].size} tiles) — cannot be merged.`);
      }
      gs.turnPhase = 'BUY_STOCKS';

    } else if (placementType === 'merge') {
      // ── MERGER INTERCEPT ──────────────────────────────────────────────────
      // Do NOT execute the merger yet. Instead, pause at CONFIRM_MERGER so
      // the active player can review what will happen and either confirm or
      // take back their tile (undo). The tile is already shown on the board.
      const adjChains = getAdjacentChains(gs.board, tileId);
      addLog(gs, `${activePlayer.name} placed ${tileId} — merger between ${adjChains.join(', ')}!`);

      // Store enough context for the confirmation dialog and the later commit.
      gs.pendingMerger = computePendingMerger(gs, tileId, adjChains);
      gs.turnPhase = 'CONFIRM_MERGER';
      // Note: initiateMerger is NOT called here — it runs in game:confirmMerger.
    }

    // Check end-game conditions now that the board has changed.
    // (Only meaningful when we've just entered BUY_STOCKS; harmless to run otherwise.)
    if (gs.turnPhase === 'BUY_STOCKS') checkAndFlagEndGame(gs);

    broadcastGameState(io, room);
    console.log(`${activePlayer.name} placed ${tileId} (${placementType}) in room ${roomCode}`);
  });

  /**
   * game:nameChain
   * Active player picks a name for the hotel chain they just founded.
   *
   * Flow:
   *   1. Validate NAME_CHAIN phase, active player, chosen name is available
   *   2. Flood-fill all connected lone tiles → mark them as the new chain
   *   3. Award 1 free stock to the founding player (if bank has any)
   *   4. Advance to BUY_STOCKS phase
   */
  socket.on('game:nameChain', ({ playerId, roomCode, chainName }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs           = room.gameState;
    const activePlayer = gs.players[gs.activePlayerIndex];

    // --- Validation ---
    if (activePlayer.id !== playerId) {
      socket.emit('error', { message: "It's not your turn." }); return;
    }
    if (gs.turnPhase !== 'NAME_CHAIN') {
      socket.emit('error', { message: 'No chain to name right now.' }); return;
    }
    if (!gs.chains[chainName]) {
      socket.emit('error', { message: `Unknown chain name: ${chainName}.` }); return;
    }
    if (gs.chains[chainName].isActive) {
      socket.emit('error', { message: `${chainName} is already on the board.` }); return;
    }

    // --- Found the chain ---
    const chainSize = foundChain(gs, gs.pendingFoundTileId, chainName);
    gs.pendingFoundTileId = null;

    addLog(gs, `${activePlayer.name} founded ${chainName} (${chainSize} tiles).`);

    // Award 1 free stock to the founding player (if any shares remain in the bank)
    const playerRecord = gs.players.find(p => p.id === playerId);
    if (gs.stockBank[chainName] > 0) {
      gs.stockBank[chainName]--;
      playerRecord.stocks[chainName]++;
      const price = getStockPrice(chainName, chainSize);
      addLog(gs, `${activePlayer.name} received 1 free ${chainName} share (worth $${price}).`);
    }

    gs.turnPhase = 'BUY_STOCKS';
    checkAndFlagEndGame(gs);

    broadcastGameState(io, room);
    console.log(`${activePlayer.name} founded ${chainName} (size ${chainSize}) in room ${roomCode}`);
  });

  /**
   * game:endTurn
   * Active player is done buying and ends their turn.
   *
   * Now accepts a `purchases` array so buying and ending turn happen in one action.
   * purchases = [{ chainName, quantity }, ...]  — empty array means player skips buying.
   *
   * Flow:
   *   1. Validate BUY_STOCKS phase, active player
   *   2. Validate and apply stock purchases
   *   3. Draw a tile to refill hand to 6
   *   4. Replace any unplayable tiles
   *   5. Advance to next player → PLACE_TILE phase
   */
  socket.on('game:endTurn', ({ playerId, roomCode, purchases = [] }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs           = room.gameState;
    const activePlayer = gs.players[gs.activePlayerIndex];

    // --- Validation ---
    if (activePlayer.id !== playerId) {
      socket.emit('error', { message: "It's not your turn." }); return;
    }
    if (gs.turnPhase !== 'BUY_STOCKS') {
      socket.emit('error', { message: 'You cannot end your turn right now.' }); return;
    }

    // --- Validate and apply stock purchases ---
    const validation = validatePurchase(gs, playerId, purchases);
    if (!validation.valid) {
      socket.emit('error', { message: validation.error }); return;
    }
    if (purchases.length > 0) {
      applyPurchase(gs, playerId, purchases);
      const summary = purchases
        .map(p => `${p.quantity}× ${p.chainName}`)
        .join(', ');
      addLog(gs, `${activePlayer.name} bought: ${summary} ($${validation.totalCost.toLocaleString()}).`);
    }

    // --- Draw a tile to refill hand to 6 ---
    const hand        = room.playerTiles[playerId] ?? [];
    const tilesToDraw = Math.max(0, 6 - hand.length);
    if (tilesToDraw > 0 && gs.drawPile.length > 0) {
      const newTiles = drawTiles(gs.drawPile, tilesToDraw);
      room.playerTiles[playerId] = [...hand, ...newTiles];
    }

    // --- Replace any unplayable tiles (e.g. would merge two safe chains) ---
    const updatedHand = room.playerTiles[playerId] ?? [];
    const unplayable  = findUnplayableTiles(gs, updatedHand);
    if (unplayable.length > 0) {
      const keepable     = updatedHand.filter(t => !unplayable.includes(t));
      const replacements = drawTiles(gs.drawPile, unplayable.length);
      room.playerTiles[playerId] = [...keepable, ...replacements];
      addLog(gs, `${activePlayer.name}'s unplayable tile(s) were automatically replaced.`);
    }

    // --- Advance to next player ---
    advanceToNextPlayer(gs);
    gs.turnPhase        = 'PLACE_TILE';
    gs.hasActedThisTurn = false;  // new player hasn't placed a tile yet
    gs.isTurnLocked     = false;  // unlock for the new turn

    const nextPlayer = gs.players[gs.activePlayerIndex];
    addLog(gs, `It is now ${nextPlayer.name}'s turn.`);

    // Snapshot the clean start-of-turn state so the next player can undo if needed
    snapshotTurn(room);

    broadcastGameState(io, room);
    console.log(`Turn ended in room ${roomCode}. Now: ${nextPlayer.name}'s turn.`);
  });

  /**
   * game:retire
   * Active player announces retirement instead of placing a tile.
   *
   * Rules:
   *   - Only valid during the PLACE_TILE phase on the player's own turn.
   *   - The player's tile hand is permanently removed from the draw pile (those
   *     positions are retired and can never be placed).
   *   - The player is marked isRetired = true and skipped in all future turns.
   *   - They keep their cash and stocks (final payouts happen at end game).
   *   - If all non-retired players are now retired, the game ends immediately.
   */
  socket.on('game:retire', ({ playerId, roomCode }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs           = room.gameState;
    const activePlayer = gs.players[gs.activePlayerIndex];

    // --- Validation ---
    if (activePlayer.id !== playerId) {
      socket.emit('error', { message: "It's not your turn." }); return;
    }
    if (gs.turnPhase !== 'PLACE_TILE') {
      socket.emit('error', { message: 'You can only retire at the start of your turn.' }); return;
    }
    if (activePlayer.isRetired) {
      socket.emit('error', { message: 'You are already retired.' }); return;
    }

    // --- Retire the player ---
    // Permanently remove their held tiles so they can never be drawn again.
    const hand = room.playerTiles[playerId] ?? [];
    gs.retiredTilePositions.push(...hand);
    room.playerTiles[playerId] = []; // hand is now empty

    activePlayer.isRetired = true;
    addLog(gs, `${activePlayer.name} has retired. Their ${hand.length} tile(s) are permanently removed from play.`);

    // --- Check if all remaining players are retired (game must end) ---
    const activePlayers = gs.players.filter(p => !p.isRetired);
    if (activePlayers.length === 0) {
      gs.isGameOver      = true;
      gs.endGameAvailable = true;
      gs.endGameReason   = 'All players have retired.';
      addLog(gs, 'All players have retired — the game is over!');
      broadcastGameState(io, room);
      console.log(`All players retired in room ${roomCode}. Game over.`);
      return;
    }

    // --- Advance to the next active player ---
    advanceToNextPlayer(gs);
    gs.turnPhase        = 'PLACE_TILE';
    gs.hasActedThisTurn = false;
    gs.isTurnLocked     = false;

    const nextPlayer = gs.players[gs.activePlayerIndex];
    addLog(gs, `It is now ${nextPlayer.name}'s turn.`);

    // Snapshot the clean start-of-turn state for the next player
    snapshotTurn(room);

    broadcastGameState(io, room);
    console.log(`${activePlayer.name} retired in room ${roomCode}. Next: ${nextPlayer.name}.`);
  });

  /**
   * game:chooseSurvivor
   * Active player picks which chain survives a tied merger.
   * Only valid during the CHOOSE_SURVIVOR phase.
   */
  socket.on('game:chooseSurvivor', ({ playerId, roomCode, survivorChain }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs           = room.gameState;
    const activePlayer = gs.players[gs.activePlayerIndex];

    if (activePlayer.id !== playerId) {
      socket.emit('error', { message: "It's not your turn." }); return;
    }
    if (gs.turnPhase !== 'CHOOSE_SURVIVOR') {
      socket.emit('error', { message: 'No survivor to choose right now.' }); return;
    }
    if (!gs.mergerContext?.candidateChains.includes(survivorChain)) {
      socket.emit('error', { message: `${survivorChain} is not a valid choice.` }); return;
    }

    addLog(gs, `${activePlayer.name} chose ${survivorChain} as the survivor.`);

    const { phase, bonusLogs, defunctChain } = applySurvivorChoice(gs, survivorChain);
    for (const msg of bonusLogs) addLog(gs, msg);
    if (phase === 'MERGER_DECISIONS') {
      addLog(gs, `Resolving ${defunctChain} — waiting for player decisions.`);
    }
    gs.turnPhase = phase;

    broadcastGameState(io, room);
    console.log(`${activePlayer.name} chose survivor ${survivorChain} in room ${roomCode}`);
  });

  /**
   * game:mergerDecision
   * A player decides what to do with their defunct chain stock:
   *   sell: sell N shares back to bank at defunct-chain price
   *   trade: trade 2N defunct shares for N survivor shares
   *   keep: whatever remains (sell + trade may be < total owned)
   *
   * Players must decide in the order specified by pendingDecisions[0].
   */
  socket.on('game:mergerDecision', ({ playerId, roomCode, sell = 0, trade = 0 }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs = room.gameState;

    if (gs.turnPhase !== 'MERGER_DECISIONS') {
      socket.emit('error', { message: 'No merger decisions right now.' }); return;
    }

    const validation = validateMergerDecision(gs, playerId, { sell, trade });
    if (!validation.valid) {
      socket.emit('error', { message: validation.error }); return;
    }

    const player  = gs.players.find(p => p.id === playerId);
    const defunct = gs.mergerContext.currentDefunct;
    const owned   = player.stocks[defunct] ?? 0;
    const keep    = owned - sell - trade;
    addLog(gs, `${player.name}: sell ${sell}, trade ${trade}, keep ${keep} ${defunct} shares.`);

    applyMergerDecision(gs, playerId, { sell, trade });

    // If everyone in the queue has decided, advance to the next defunct (or BUY_STOCKS)
    if (gs.mergerContext.pendingDecisions.length === 0) {
      const { phase, bonusLogs, defunctChain } = advanceMerger(gs);
      for (const msg of bonusLogs) addLog(gs, msg);
      if (phase === 'MERGER_DECISIONS') {
        addLog(gs, `Resolving ${defunctChain} — waiting for player decisions.`);
      }
      gs.turnPhase = phase;

      // A completed merger can push the survivor to 41+ tiles or make all chains safe.
      if (phase === 'BUY_STOCKS') checkAndFlagEndGame(gs);
    }

    broadcastGameState(io, room);
  });

  /**
   * game:declareEndGame
   * Active player officially ends the game (only valid when endGameAvailable is true).
   *
   * This can only be sent during the BUY_STOCKS phase — the player may buy stock
   * normally first and then declare, or declare immediately (with purchases = []).
   * Purchases are handled by the existing game:endTurn event; this event is sent
   * INSTEAD of game:endTurn when the player wants to trigger end-game.
   *
   * Flow:
   *   1. Validate conditions (endGameAvailable, active player, BUY_STOCKS phase).
   *   2. Optionally apply any final stock purchases (same logic as game:endTurn).
   *   3. Execute final payouts (bonuses → liquidation → determine winner).
   *   4. Set isGameOver = true, turnPhase = 'GAME_OVER', winner = winnerId.
   *   5. Broadcast final state to all clients.
   */
  socket.on('game:declareEndGame', ({ playerId, roomCode, purchases = [] }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs           = room.gameState;
    const activePlayer = gs.players[gs.activePlayerIndex];

    // --- Validation ---
    if (!gs.endGameAvailable) {
      socket.emit('error', { message: 'End-game conditions have not been met yet.' }); return;
    }
    if (gs.isGameOver) {
      socket.emit('error', { message: 'The game is already over.' }); return;
    }
    if (activePlayer.id !== playerId) {
      socket.emit('error', { message: 'Only the active player can declare the game over.' }); return;
    }
    if (gs.turnPhase !== 'BUY_STOCKS') {
      socket.emit('error', { message: 'You can only declare the game over during the buy phase.' }); return;
    }

    // --- Optional final stock purchases (identical logic to game:endTurn) ---
    if (purchases.length > 0) {
      const validation = validatePurchase(gs, playerId, purchases);
      if (!validation.valid) {
        socket.emit('error', { message: validation.error }); return;
      }
      applyPurchase(gs, playerId, purchases);
      const summary = purchases.map(p => `${p.quantity}× ${p.chainName}`).join(', ');
      addLog(gs, `${activePlayer.name} bought: ${summary} ($${validation.totalCost.toLocaleString()}) before declaring end game.`);
    }

    // --- Declare game over and run final payouts ---
    gs.isGameOver = true;
    gs.turnPhase  = 'GAME_OVER';
    addLog(gs, `${activePlayer.name} has declared the game over! (${gs.endGameReason})`);

    const { logs, winnerId } = executeEndGamePayouts(gs);
    for (const msg of logs) addLog(gs, msg);

    gs.winner = winnerId;
    const winner = gs.players.find(p => p.id === winnerId);

    broadcastGameState(io, room);
    console.log(`Game over in room ${roomCode}. Winner: ${winner.name} ($${winner.cash.toLocaleString()})`);
  });

  /**
   * game:undoTurn
   * Active player takes back their tile placement, restoring the board, their
   * hand, and all game state to exactly how it was at the start of this turn.
   *
   * Valid only when:
   *   - It is this player's turn
   *   - They have already acted (hasActedThisTurn = true)
   *   - The turn is not yet locked (isTurnLocked = false, i.e. no merger confirmed)
   */
  socket.on('game:undoTurn', ({ playerId, roomCode }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs           = room.gameState;
    const activePlayer = gs.players[gs.activePlayerIndex];

    if (activePlayer.id !== playerId) {
      socket.emit('error', { message: "It's not your turn." }); return;
    }
    if (!gs.hasActedThisTurn) {
      socket.emit('error', { message: 'You have not placed a tile yet — nothing to undo.' }); return;
    }
    if (gs.isTurnLocked) {
      socket.emit('error', { message: 'This move has already been confirmed and cannot be undone.' }); return;
    }
    if (!room.turnSnapshot) {
      socket.emit('error', { message: 'No snapshot available — cannot undo.' }); return;
    }

    // Restore state from snapshot. Deep-clone so the snapshot stays intact
    // (in case the player undoes, acts again, and wants to undo once more).
    room.gameState   = deepClone(room.turnSnapshot.gameState);
    room.playerTiles = deepClone(room.turnSnapshot.playerTiles);

    broadcastGameState(io, room);
    console.log(`${activePlayer.name} undid their turn in room ${roomCode}`);
  });

  /**
   * game:confirmMerger
   * Active player confirms the merger they just triggered by placing a tile.
   * This is the commit point — the turn becomes locked after this, so it
   * cannot be undone.
   *
   * Flow:
   *   1. Validate CONFIRM_MERGER phase and active player.
   *   2. Lock the turn (isTurnLocked = true — no more undos).
   *   3. Execute initiateMerger with the stored pendingMerger context.
   *   4. Advance to CHOOSE_SURVIVOR or MERGER_DECISIONS as normal.
   */
  socket.on('game:confirmMerger', ({ playerId, roomCode }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs           = room.gameState;
    const activePlayer = gs.players[gs.activePlayerIndex];

    if (activePlayer.id !== playerId) {
      socket.emit('error', { message: "It's not your turn." }); return;
    }
    if (gs.turnPhase !== 'CONFIRM_MERGER') {
      socket.emit('error', { message: 'No merger to confirm right now.' }); return;
    }

    // Extract the stored context and clear it before mutating state
    const { tileId, adjChains } = gs.pendingMerger;
    gs.pendingMerger = null;

    // Lock this turn — undo is no longer possible once the merger runs
    gs.isTurnLocked = true;

    // Now run the existing merger logic exactly as before
    const { needsSurvivorChoice, candidateChains } = initiateMerger(
      gs, tileId, adjChains, gs.activePlayerIndex
    );

    if (needsSurvivorChoice) {
      gs.turnPhase = 'CHOOSE_SURVIVOR';
      addLog(gs, `Tied at ${gs.chains[candidateChains[0]].size} tiles — ${activePlayer.name} must pick the survivor.`);
    } else {
      const survivor = gs.mergerContext.survivorChain;
      addLog(gs, `${survivor} survives.`);
      const { phase, bonusLogs, defunctChain } = advanceMerger(gs);
      for (const msg of bonusLogs) addLog(gs, msg);
      if (phase === 'MERGER_DECISIONS') {
        addLog(gs, `Resolving ${defunctChain} — waiting for player decisions.`);
      }
      gs.turnPhase = phase;
    }

    // A completed merger can trigger end-game conditions
    if (gs.turnPhase === 'BUY_STOCKS') checkAndFlagEndGame(gs);

    broadcastGameState(io, room);
    console.log(`${activePlayer.name} confirmed merger in room ${roomCode}`);
  });

  /**
   * game:playAgain
   * Any player in the room can trigger a rematch once the game is over.
   *
   * Reuses the same room code and player list; everything else is reset to
   * a fresh initial state (new shuffle, new tile hands, cleared board, etc.).
   */
  socket.on('game:playAgain', ({ playerId, roomCode }) => {
    const room = getRoom(roomCode);
    if (!room?.gameState) return;

    const gs = room.gameState;

    // --- Validation ---
    if (!gs.isGameOver) {
      socket.emit('error', { message: 'The game is not over yet.' }); return;
    }
    const requestingPlayer = gs.players.find(p => p.id === playerId);
    if (!requestingPlayer) {
      socket.emit('error', { message: 'You are not in this game.' }); return;
    }

    // --- Reset ---
    const { newGameState, newPlayerTiles } = resetGameState(gs);
    room.gameState   = newGameState;
    room.playerTiles = newPlayerTiles;

    addLog(room.gameState, `${requestingPlayer.name} started a new game!`);

    // Broadcast fresh public state + each player's new private tile hand
    broadcastGameState(io, room);
    console.log(`Room ${roomCode} restarted by ${requestingPlayer.name}.`);
  });
}
