import { getRoom } from '../rooms/roomManager.js';
import { getPublicGameState } from '../game/GameState.js';
import { classifyPlacement, isLegalPlacement, findUnplayableTiles, getAdjacentChains } from '../game/boardLogic.js';
import { drawTiles } from '../game/tileLogic.js';
import { foundChain, growChain } from '../game/chainLogic.js';
import { validatePurchase, applyPurchase, getStockPrice } from '../game/stockLogic.js';
import {
  initiateMerger, applySurvivorChoice, advanceMerger,
  validateMergerDecision, applyMergerDecision,
} from '../game/mergerLogic.js';

// ---- Helpers ----

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

    // --- Apply the move ---
    room.playerTiles[playerId] = hand.filter(t => t !== tileId);
    const placementType = classifyPlacement(gs, tileId);
    gs.board[tileId] = 'lone'; // always start as lone; chain logic may immediately reassign

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
      const adjChains = getAdjacentChains(gs.board, tileId);
      addLog(gs, `${activePlayer.name} placed ${tileId} — merger between ${adjChains.join(', ')}!`);

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
    }

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
    gs.turnPhase = 'PLACE_TILE';

    const nextPlayer = gs.players[gs.activePlayerIndex];
    addLog(gs, `It is now ${nextPlayer.name}'s turn.`);

    broadcastGameState(io, room);
    console.log(`Turn ended in room ${roomCode}. Now: ${nextPlayer.name}'s turn.`);
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
    }

    broadcastGameState(io, room);
  });
}
