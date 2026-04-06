import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { sendInviteEmail, sendTurnNotificationEmail } from '../lib/email.js';
import { createInitialGameState, getPublicGameState, checkEndGameConditions } from '../game/GameState.js';
import { classifyPlacement, getAdjacentChains, findUnplayableTiles } from '../game/boardLogic.js';
import { foundChain, growChain } from '../game/chainLogic.js';
import { validatePurchase, applyPurchase } from '../game/stockLogic.js';
import { drawTiles } from '../game/tileLogic.js';
import {
  initiateMerger,
  applySurvivorChoice,
  advanceMerger,
  validateMergerDecision,
  applyMergerDecision,
  executeEndGamePayouts,
} from '../game/mergerLogic.js';

const router = Router();

// Every game route requires a valid Supabase session.
router.use(requireAuth);

// ============================================================
// POST /api/games
// Create a new game lobby. The caller becomes the host and is
// automatically added to game_players at seat_order = 0.
// Body: { name: string }
// ============================================================
router.post('/', async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Game name is required' });
  }

  // Insert the game record
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({ host_id: req.user.id, name: name.trim() })
    .select()
    .single();

  if (gameError) return res.status(500).json({ error: gameError.message });

  // Add the host as the first confirmed player
  const { error: playerError } = await supabase
    .from('game_players')
    .insert({ game_id: game.id, user_id: req.user.id, seat_order: 0 });

  if (playerError) return res.status(500).json({ error: playerError.message });

  res.status(201).json(game);
});

// ============================================================
// GET /api/games
// List all games the authenticated user is involved in:
// as host, as a confirmed player, or as an invitee (any status).
// ============================================================
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const userEmail = req.user.email;

  // Games where user has a confirmed seat
  const { data: playerRows, error: e1 } = await supabase
    .from('game_players')
    .select('game_id')
    .eq('user_id', userId);

  if (e1) return res.status(500).json({ error: e1.message });

  // Games where user has been invited (match by email address)
  const { data: inviteRows, error: e2 } = await supabase
    .from('game_invites')
    .select('game_id')
    .eq('invitee_email', userEmail);

  if (e2) return res.status(500).json({ error: e2.message });

  // Merge and de-duplicate game IDs from both sources
  const gameIds = [
    ...new Set([
      ...(playerRows || []).map(r => r.game_id),
      ...(inviteRows || []).map(r => r.game_id),
    ]),
  ];

  if (gameIds.length === 0) return res.json([]);

  const { data: games, error: e3 } = await supabase
    .from('games')
    .select('*')
    .in('id', gameIds)
    .order('created_at', { ascending: false });

  if (e3) return res.status(500).json({ error: e3.message });

  res.json(games);
});

// ============================================================
// GET /api/games/:gameId
// Full lobby detail: the game record + invite list + player list.
// Any authenticated user may read this (needed to render the lobby).
// ============================================================
router.get('/:gameId', async (req, res) => {
  const { gameId } = req.params;

  const [gameResult, invitesResult, playersResult] = await Promise.all([
    supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single(),

    supabase
      .from('game_invites')
      .select('*')
      .eq('game_id', gameId)
      .order('invited_at'),

    // Join to users so the client can show player names + avatars
    supabase
      .from('game_players')
      .select('*, users(id, display_name, avatar_url, email)')
      .eq('game_id', gameId)
      .order('seat_order'),
  ]);

  if (gameResult.error) return res.status(404).json({ error: 'Game not found' });

  res.json({
    game: gameResult.data,
    invites: invitesResult.data || [],
    players: playersResult.data || [],
  });
});

// ============================================================
// DELETE /api/games/:gameId
// Host deletes a game that hasn't started yet.
// Security: caller must be the host; game must still be in LOBBY status.
// Cascade deletes handle game_players, game_invites, etc.
// ============================================================
router.delete('/:gameId', async (req, res) => {
  const { gameId } = req.params;

  const { data: game } = await supabase
    .from('games')
    .select('host_id, status')
    .eq('id', gameId)
    .single();

  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.host_id !== req.user.id) return res.status(403).json({ error: 'Only the host can delete this game' });
  if (game.status !== 'LOBBY') return res.status(400).json({ error: 'Only games in the lobby can be deleted' });

  const { error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

// ============================================================
// POST /api/games/:gameId/invite
// Host invites a player by email address. Sends an invite email.
// Body: { email: string }
// ============================================================
router.post('/:gameId/invite', async (req, res) => {
  const { gameId } = req.params;
  const { email } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Load the game to verify host and status
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('id, name, host_id, status')
    .eq('id', gameId)
    .single();

  if (gameError || !game) return res.status(404).json({ error: 'Game not found' });
  if (game.host_id !== req.user.id) return res.status(403).json({ error: 'Only the host can invite players' });
  if (game.status !== 'LOBBY') return res.status(400).json({ error: 'Game has already started' });
  if (normalizedEmail === req.user.email.toLowerCase()) {
    return res.status(400).json({ error: 'You cannot invite yourself' });
  }

  // Acquire supports up to 6 players. Host occupies seat 0, so max 5 invites.
  const { count: activeInviteCount } = await supabase
    .from('game_invites')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId)
    .neq('status', 'DECLINED');

  if (activeInviteCount >= 5) {
    return res.status(400).json({ error: 'Maximum of 6 players per game' });
  }

  // Insert the invite record
  const { data: invite, error: inviteError } = await supabase
    .from('game_invites')
    .insert({ game_id: gameId, invitee_email: normalizedEmail })
    .select()
    .single();

  if (inviteError) {
    // Unique constraint violation means they were already invited
    if (inviteError.code === '23505') {
      return res.status(409).json({ error: 'That player has already been invited' });
    }
    return res.status(500).json({ error: inviteError.message });
  }

  // Send the invite email. Non-blocking — a failed email doesn't roll back the invite.
  sendInviteEmail(normalizedEmail, game.name, invite.id).catch(err =>
    console.error('[email] Failed to send invite email:', err.message)
  );

  res.status(201).json(invite);
});

// ============================================================
// DELETE /api/games/:gameId/invite/:inviteId
// Host cancels a PENDING invite, freeing the slot.
// ============================================================
router.delete('/:gameId/invite/:inviteId', async (req, res) => {
  const { gameId, inviteId } = req.params;

  const { data: game } = await supabase
    .from('games')
    .select('host_id, status')
    .eq('id', gameId)
    .single();

  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.host_id !== req.user.id) return res.status(403).json({ error: 'Only the host can cancel invites' });
  if (game.status !== 'LOBBY') return res.status(400).json({ error: 'Game has already started' });

  const { error } = await supabase
    .from('game_invites')
    .delete()
    .eq('id', inviteId)
    .eq('game_id', gameId)
    .eq('status', 'PENDING');

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

// ============================================================
// POST /api/games/:gameId/start
// Host starts the game.
// Blocked if: any invite is still PENDING, or player count < 2.
// NOTE: Full game state initialization (tile dealing, etc.) is wired in Phase 3.
// ============================================================
router.post('/:gameId/start', async (req, res) => {
  const { gameId } = req.params;

  const { data: game } = await supabase
    .from('games')
    .select('host_id, status, name')
    .eq('id', gameId)
    .single();

  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.host_id !== req.user.id) return res.status(403).json({ error: 'Only the host can start the game' });
  if (game.status !== 'LOBBY') return res.status(400).json({ error: 'Game has already started' });

  // Block if any invite is still outstanding
  const { count: pendingCount } = await supabase
    .from('game_invites')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId)
    .eq('status', 'PENDING');

  if (pendingCount > 0) {
    return res.status(400).json({
      error: `${pendingCount} invite(s) are still pending. All invites must be accepted or declined before starting.`,
    });
  }

  // Enforce the 2-player minimum
  const { count: playerCount } = await supabase
    .from('game_players')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId);

  if (playerCount < 2) {
    return res.status(400).json({ error: 'At least 2 players must have accepted to start the game.' });
  }

  // Load the confirmed player roster (ordered by seat so seat 0 goes first)
  const { data: playerRows, error: prError } = await supabase
    .from('game_players')
    .select('user_id, seat_order, users(display_name, email)')
    .eq('game_id', gameId)
    .order('seat_order');

  if (prError) return res.status(500).json({ error: prError.message });

  // createInitialGameState expects [{ id, name }]
  const players = playerRows.map(row => ({
    id: row.user_id,
    name: row.users.display_name || row.users.email,
  }));

  // Shuffle tiles, deal 6 to each player, build the initial board & chain state
  const { gameState, playerTiles } = createInitialGameState(players);

  // Split into the three DB columns:
  //   public_state  — everything players can see (no draw pile)
  //   player_tiles  — each player's private hand: { userId: [tileId, ...] }
  //   draw_pile     — remaining tiles, server-only
  const { drawPile, ...publicState } = gameState;

  // Persist the initial game state
  const { error: gsError } = await supabase
    .from('game_states')
    .insert({ game_id: gameId, public_state: publicState, player_tiles: playerTiles, draw_pile: drawPile });

  if (gsError) return res.status(500).json({ error: gsError.message });

  // Transition the game to ACTIVE
  const { error: updateError } = await supabase
    .from('games')
    .update({ status: 'ACTIVE', started_at: new Date().toISOString() })
    .eq('id', gameId);

  if (updateError) return res.status(500).json({ error: updateError.message });

  // Notify the first player it's their turn
  const firstPlayer = players[0];
  const { data: firstUser } = await supabase
    .from('users').select('email').eq('id', firstPlayer.id).single();
  if (firstUser?.email) {
    sendTurnNotificationEmail(firstUser.email, game.name, gameId)
      .catch(err => console.error('[email] Failed to send turn notification:', err.message));
  }

  res.json({ success: true });
});

// ============================================================
// GET /api/games/:gameId/state
// Primary polling endpoint. Returns the public game state plus
// the requesting player's private tile hand.
// The draw pile is never sent to any client.
// ============================================================
router.get('/:gameId/state', async (req, res) => {
  const { gameId } = req.params;

  const { data: gs, error } = await supabase
    .from('game_states')
    .select('public_state, player_tiles, draw_pile')
    .eq('game_id', gameId)
    .single();

  if (error || !gs) return res.status(404).json({ error: 'Game state not found' });

  // Only send the requesting player's own tile hand
  const myTiles = gs.player_tiles[req.user.id] ?? [];

  res.json({
    publicState: gs.public_state,
    myTiles,
    drawPileCount: gs.draw_pile.length,
  });
});

// ============================================================
// POST /api/games/:gameId/turn
// Submit a full turn: tile placement + optional chain founding
// + optional stock purchase. All in one atomic request.
//
// Body:
//   tilePlaced   {string}            — required, e.g. "A3"
//   chainFounded {string}            — required only if tile founds a new chain
//   stocksBought {object}            — optional, e.g. { "luxor": 2, "tower": 1 }
// ============================================================
router.post('/:gameId/turn', async (req, res) => {
  const { gameId } = req.params;
  const { tilePlaced, chainFounded, stocksBought = {} } = req.body;

  if (!tilePlaced) return res.status(400).json({ error: 'tilePlaced is required' });

  // ---- Load game record ----
  const { data: game } = await supabase
    .from('games').select('status, name').eq('id', gameId).single();

  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.status !== 'ACTIVE') return res.status(400).json({ error: 'Game is not active' });

  // ---- Load game state ----
  const { data: gs, error: gsError } = await supabase
    .from('game_states')
    .select('public_state, player_tiles, draw_pile')
    .eq('game_id', gameId)
    .single();

  if (gsError || !gs) return res.status(500).json({ error: 'Could not load game state' });

  // Reassemble the full in-memory state object (public_state has no drawPile; we add it back)
  const state = { ...gs.public_state, drawPile: gs.draw_pile };
  const playerTiles = gs.player_tiles;

  // ---- Validate: caller must be the active player ----
  const activePlayer = state.players[state.activePlayerIndex];
  if (activePlayer.id !== req.user.id) {
    return res.status(403).json({ error: 'It is not your turn' });
  }

  // ---- Validate: tile must be in the player's hand ----
  const hand = playerTiles[req.user.id] ?? [];
  if (!hand.includes(tilePlaced)) {
    return res.status(400).json({ error: 'That tile is not in your hand' });
  }

  // ---- Classify the tile placement (before mutating the board) ----
  const classification = classifyPlacement(state, tilePlaced);
  if (classification === 'illegal') {
    return res.status(400).json({ error: 'That tile cannot be played here (illegal placement)' });
  }
  if (classification === 'merge') {
    return res.status(400).json({ error: 'Mergers are coming in Phase 4. This tile cannot be played yet.' });
  }

  // Capture adjacent chains BEFORE marking the tile as lone (grow case needs this)
  const adjacentChainsAtPlacement = getAdjacentChains(state.board, tilePlaced);

  // ---- Apply the tile (mark as lone on the board) ----
  state.board[tilePlaced] = 'lone';
  playerTiles[req.user.id] = hand.filter(t => t !== tilePlaced);

  // ---- Apply chain logic based on classification ----
  let eventLog = `${activePlayer.name} placed ${tilePlaced}`;

  if (classification === 'found') {
    // Player must have chosen a chain name
    if (!chainFounded || !state.chains[chainFounded]) {
      return res.status(400).json({ error: 'chainFounded is required when a tile founds a new chain' });
    }
    if (state.chains[chainFounded].isActive) {
      return res.status(400).json({ error: `${chainFounded} is already on the board` });
    }

    const size = foundChain(state, tilePlaced, chainFounded);

    // Acquire rule: the founder receives 1 free share from the bank (if available)
    if (state.stockBank[chainFounded] > 0) {
      state.stockBank[chainFounded] -= 1;
      state.players[state.activePlayerIndex].stocks[chainFounded] += 1;
    }

    eventLog += ` — founded ${chainFounded} (${size} tiles). Received 1 free share.`;

  } else if (classification === 'grow') {
    // adjacentChainsAtPlacement was captured before the tile was marked lone.
    // For 'grow', there is exactly one adjacent chain.
    const chainName = adjacentChainsAtPlacement[0];
    growChain(state, tilePlaced, chainName);
    eventLog += ` — ${chainName} grew to ${state.chains[chainName].size} tiles`;

  } else {
    // 'simple' — isolated tile, nothing else to do
    eventLog += ' (lone tile)';
  }

  // ---- Validate and apply stock purchases ----
  // Convert { chainName: qty } object to the array format stockLogic expects
  const purchaseList = Object.entries(stocksBought)
    .map(([chainName, quantity]) => ({ chainName, quantity: Number(quantity) }))
    .filter(p => p.quantity > 0);

  if (purchaseList.length > 0) {
    const { valid, error: purchaseError, totalCost } = validatePurchase(state, req.user.id, purchaseList);
    if (!valid) return res.status(400).json({ error: purchaseError });

    applyPurchase(state, req.user.id, purchaseList);
    eventLog += `. Bought ${purchaseList.map(p => `${p.quantity}× ${p.chainName}`).join(', ')} ($${totalCost.toLocaleString()})`;
  }

  // ---- Draw a replacement tile ----
  const drawn = drawTiles(state.drawPile, 1);
  if (drawn.length > 0) {
    playerTiles[req.user.id] = [...playerTiles[req.user.id], ...drawn];
  }

  // ---- Advance turn to next non-retired player ----
  const numPlayers = state.players.length;
  let nextIdx = state.activePlayerIndex;
  for (let i = 1; i <= numPlayers; i++) {
    nextIdx = (state.activePlayerIndex + i) % numPlayers;
    if (!state.players[nextIdx].isRetired) break;
  }
  if (nextIdx <= state.activePlayerIndex && state.activePlayerIndex !== 0) {
    state.turnNumber += 1;
  }
  state.activePlayerIndex = nextIdx;
  state.turnPhase = 'PLACE_TILE';
  state.hasActedThisTurn = false;

  // ---- Append to the game log ----
  state.log = [{ time: new Date().toISOString(), message: eventLog }, ...(state.log ?? [])].slice(0, 50);

  // ---- Persist the updated state ----
  const { drawPile: newDrawPile, ...newPublicState } = state;
  const { error: saveError } = await supabase
    .from('game_states')
    .update({ public_state: newPublicState, player_tiles: playerTiles, draw_pile: newDrawPile, updated_at: new Date().toISOString() })
    .eq('game_id', gameId);

  if (saveError) return res.status(500).json({ error: saveError.message });

  // ---- Notify next player by email ----
  const nextPlayer = state.players[state.activePlayerIndex];
  const { data: nextUser } = await supabase
    .from('users').select('email').eq('id', nextPlayer.id).single();
  if (nextUser?.email) {
    sendTurnNotificationEmail(nextUser.email, game.name, gameId)
      .catch(err => console.error('[email] Failed to send turn notification:', err.message));
  }

  // ---- Respond with updated state (so the client can refresh immediately) ----
  res.json({
    publicState: newPublicState,
    myTiles: playerTiles[req.user.id] ?? [],
    drawPileCount: newDrawPile.length,
  });
});

// ============================================================
// Shared helper: load game state from DB and reconstruct the
// full in-memory object. Returns null on failure.
// ============================================================
async function loadState(gameId) {
  const { data: gs, error } = await supabase
    .from('game_states')
    .select('public_state, player_tiles, draw_pile')
    .eq('game_id', gameId)
    .single();
  if (error || !gs) return null;
  return {
    // Merge drawPile back in so all logic modules can mutate it
    state: { ...gs.public_state, drawPile: gs.draw_pile },
    playerTiles: gs.player_tiles,
  };
}

// ============================================================
// Shared helper: persist the mutated state back to DB.
// Splits drawPile back out before writing public_state.
// ============================================================
async function saveState(gameId, state, playerTiles) {
  const { drawPile, ...publicState } = state;
  const { error } = await supabase
    .from('game_states')
    .update({
      public_state: publicState,
      player_tiles: playerTiles,
      draw_pile: drawPile,
      updated_at: new Date().toISOString(),
    })
    .eq('game_id', gameId);
  if (error) return { error };
  return { publicState, drawPile };
}

// ============================================================
// POST /api/games/:gameId/play-tile
// Step 1 of a turn: place a tile on the board.
// Handles simple placement, chain founding, and chain growth.
// Returns "Mergers coming soon!" for merge tiles (Phase 4).
// Transitions turnPhase: PLACE_TILE → BUY_STOCKS
//
// Body:
//   tilePlaced   {string}  — e.g. "C4"
//   chainFounded {string}  — required only when tile founds a new chain
// ============================================================
router.post('/:gameId/play-tile', async (req, res) => {
  const { gameId } = req.params;
  const { tilePlaced, chainFounded } = req.body;

  if (!tilePlaced) return res.status(400).json({ error: 'tilePlaced is required' });

  // Load game record
  const { data: game } = await supabase
    .from('games').select('status, name').eq('id', gameId).single();
  if (!game)                      return res.status(404).json({ error: 'Game not found' });
  if (game.status !== 'ACTIVE')   return res.status(400).json({ error: 'Game is not active' });

  // Load game state
  const loaded = await loadState(gameId);
  if (!loaded) return res.status(500).json({ error: 'Could not load game state' });
  const { state, playerTiles } = loaded;

  // Gate: must be the active player's PLACE_TILE phase
  const activePlayer = state.players[state.activePlayerIndex];
  if (activePlayer.id !== req.user.id)     return res.status(403).json({ error: 'It is not your turn' });
  if (state.turnPhase !== 'PLACE_TILE')    return res.status(400).json({ error: `Wrong phase: currently ${state.turnPhase}` });

  // Tile must be in hand
  const hand = playerTiles[req.user.id] ?? [];
  if (!hand.includes(tilePlaced)) return res.status(400).json({ error: 'That tile is not in your hand' });

  // Classify (before mutating the board)
  const classification = classifyPlacement(state, tilePlaced);
  if (classification === 'illegal') return res.status(400).json({ error: 'That tile cannot be played here' });

  // Capture adjacent chains before any board mutation — needed for grow and merge
  const adjacentChains = getAdjacentChains(state.board, tilePlaced);

  // ---- Merger handling — fully resolved here, returns early ----
  if (classification === 'merge') {
    // Mark tile as 'lone' first — initiateMerger requires this
    state.board[tilePlaced] = 'lone';
    playerTiles[req.user.id] = hand.filter(t => t !== tilePlaced);

    const { needsSurvivorChoice, candidateChains } = initiateMerger(
      state, tilePlaced, adjacentChains, state.activePlayerIndex
    );

    if (needsSurvivorChoice) {
      // Two or more chains are the same size — active player must choose which survives
      state.turnPhase = 'CHOOSE_SURVIVOR';
      state.log = [{
        time: new Date().toISOString(),
        message: `${activePlayer.name} placed ${tilePlaced} — tied merger! Must choose the surviving chain.`,
      }, ...(state.log ?? [])].slice(0, 50);
      const saved = await saveState(gameId, state, playerTiles);
      if (saved.error) return res.status(500).json({ error: saved.error.message });
      return res.json({
        publicState: saved.publicState,
        myTiles:     playerTiles[req.user.id] ?? [],
        drawPileCount: saved.drawPile.length,
        needsSurvivorChoice: true,
        candidateChains,
      });
    }

    // No tie — drive the merger state machine forward
    const { phase, bonusLogs } = advanceMerger(state);
    state.log = [
      ...bonusLogs.map(msg => ({ time: new Date().toISOString(), message: msg })),
      { time: new Date().toISOString(), message: `${activePlayer.name} placed ${tilePlaced} — merger triggered!` },
      ...(state.log ?? []),
    ].slice(0, 50);

    if (phase === 'BUY_STOCKS') {
      // No defunct stockholders needed decisions — jump straight to buying.
      // Game status stays ACTIVE; no DB update needed here.
      state.turnPhase = 'BUY_STOCKS';
      const { canEnd, reason } = checkEndGameConditions(state);
      state.endGameAvailable = canEnd;
      state.endGameReason    = reason ?? null;
    } else {
      // At least one player must decide what to do with defunct shares.
      // Mark game MERGER_PAUSE so buy-stocks / end-turn are correctly blocked
      // until all decisions are submitted and the merger fully resolves.
      state.turnPhase = 'MERGER_DECISIONS';
      const { error: statusError } = await supabase
        .from('games')
        .update({ status: 'MERGER_PAUSE' })
        .eq('id', gameId);
      if (statusError) {
        console.error('[play-tile] Failed to set game status to MERGER_PAUSE:', statusError.message);
        return res.status(500).json({ error: 'Merger triggered but failed to update game status. Please retry.' });
      }
    }

    const saved = await saveState(gameId, state, playerTiles);
    if (saved.error) return res.status(500).json({ error: saved.error.message });
    return res.json({
      publicState:   saved.publicState,
      myTiles:       playerTiles[req.user.id] ?? [],
      drawPileCount: saved.drawPile.length,
      classification,
    });
  }

  // ---- Non-merger tile placement (simple / grow / found) ----
  // Place the tile as a lone tile on the board
  state.board[tilePlaced] = 'lone';
  playerTiles[req.user.id] = hand.filter(t => t !== tilePlaced);

  // Apply chain logic
  let logMsg = `${activePlayer.name} placed ${tilePlaced}`;

  if (classification === 'found') {
    if (!chainFounded || !state.chains[chainFounded]) {
      return res.status(400).json({ error: 'chainFounded is required when the tile founds a new chain' });
    }
    if (state.chains[chainFounded].isActive) {
      return res.status(400).json({ error: `${chainFounded} is already on the board` });
    }
    const size = foundChain(state, tilePlaced, chainFounded);
    // Acquire rule: founder receives 1 free share
    if (state.stockBank[chainFounded] > 0) {
      state.stockBank[chainFounded] -= 1;
      state.players[state.activePlayerIndex].stocks[chainFounded] += 1;
    }
    logMsg += ` — founded ${chainFounded} (${size} tiles), received 1 free share`;

  } else if (classification === 'grow') {
    const chainName = adjacentChains[0]; // exactly one chain for 'grow'
    growChain(state, tilePlaced, chainName);
    logMsg += ` — ${chainName} grew to ${state.chains[chainName].size} tiles`;

  } else {
    logMsg += ' (lone tile)';
  }

  // Transition to stock-buying phase
  state.turnPhase = 'BUY_STOCKS';
  state.log = [{ time: new Date().toISOString(), message: logMsg }, ...(state.log ?? [])].slice(0, 50);

  // Persist
  const saved = await saveState(gameId, state, playerTiles);
  if (saved.error) return res.status(500).json({ error: saved.error.message });

  res.json({
    publicState: saved.publicState,
    myTiles: playerTiles[req.user.id] ?? [],
    drawPileCount: saved.drawPile.length,
    classification,
  });
});

// ============================================================
// POST /api/games/:gameId/choose-survivor
// Called when a merger tile connects chains of equal size (CHOOSE_SURVIVOR phase).
// Active player picks which chain survives; game advances to MERGER_DECISIONS or BUY_STOCKS.
//
// Body: { survivorChain: string }
// ============================================================
router.post('/:gameId/choose-survivor', async (req, res) => {
  const { gameId } = req.params;
  const { survivorChain } = req.body;

  if (!survivorChain) return res.status(400).json({ error: 'survivorChain is required' });

  const loaded = await loadState(gameId);
  if (!loaded) return res.status(500).json({ error: 'Could not load game state' });
  const { state, playerTiles } = loaded;

  if (!state.mergerContext)              return res.status(400).json({ error: 'No merger in progress' });
  if (state.turnPhase !== 'CHOOSE_SURVIVOR') return res.status(400).json({ error: 'Not in survivor-choice phase' });

  const activePlayer = state.players[state.activePlayerIndex];
  if (activePlayer.id !== req.user.id) {
    return res.status(403).json({ error: 'Only the active player chooses the surviving chain' });
  }
  if (!state.mergerContext.candidateChains.includes(survivorChain)) {
    return res.status(400).json({ error: `${survivorChain} is not one of the tied chains` });
  }

  const { phase, bonusLogs } = applySurvivorChoice(state, survivorChain);
  state.log = [
    ...bonusLogs.map(msg => ({ time: new Date().toISOString(), message: msg })),
    { time: new Date().toISOString(), message: `${activePlayer.name} chose ${survivorChain} as the surviving chain` },
    ...(state.log ?? []),
  ].slice(0, 50);

  if (phase === 'BUY_STOCKS') {
    // No one held shares in the defunct chain — merger resolved instantly.
    state.turnPhase = 'BUY_STOCKS';
    const { canEnd, reason } = checkEndGameConditions(state);
    state.endGameAvailable = canEnd;
    state.endGameReason    = reason ?? null;
  } else {
    state.turnPhase = 'MERGER_DECISIONS';
    const { error: statusError } = await supabase
      .from('games')
      .update({ status: 'MERGER_PAUSE' })
      .eq('id', gameId);
    if (statusError) {
      console.error('[choose-survivor] Failed to set game status to MERGER_PAUSE:', statusError.message);
      return res.status(500).json({ error: 'Survivor chosen but failed to update game status. Please retry.' });
    }
  }

  const saved = await saveState(gameId, state, playerTiles);
  if (saved.error) return res.status(500).json({ error: saved.error.message });
  res.json({ publicState: saved.publicState, myTiles: playerTiles[req.user.id] ?? [], drawPileCount: saved.drawPile.length });
});

// ============================================================
// POST /api/games/:gameId/merger-decision
// During MERGER_DECISIONS: a player decides what to do with their
// defunct chain shares — sell, trade (2-for-1 into survivor), or keep.
// Once all affected players have decided, the merger advances automatically.
//
// Body: { sell: number, trade: number }
//   keep = (shares held) − sell − trade  (auto-computed server-side)
// ============================================================
router.post('/:gameId/merger-decision', async (req, res) => {
  const { gameId } = req.params;
  const { sell = 0, trade = 0 } = req.body;

  const loaded = await loadState(gameId);
  if (!loaded) return res.status(500).json({ error: 'Could not load game state' });
  const { state, playerTiles } = loaded;

  if (!state.mergerContext) return res.status(400).json({ error: 'No merger in progress' });

  // Validate: caller must be next in line
  const { valid, error: valError } = validateMergerDecision(state, req.user.id, { sell, trade });
  if (!valid) return res.status(400).json({ error: valError });

  const player   = state.players.find(p => p.id === req.user.id);
  const defunct  = state.mergerContext.currentDefunct;
  const survivor = state.mergerContext.survivorChain;
  const kept     = (player.stocks[defunct] ?? 0) - Number(sell) - Number(trade);

  // Build log message before applying (shares change after apply)
  const parts = [];
  if (Number(sell)  > 0) parts.push(`sold ${sell} ${defunct}`);
  if (Number(trade) > 0) parts.push(`traded ${trade} → ${Number(trade) / 2} ${survivor}`);
  if (kept          > 0) parts.push(`kept ${kept} ${defunct}`);
  const logMsg = `${player.name}: ${parts.length > 0 ? parts.join(', ') : 'kept all shares'}`;

  // Apply the decision (removes player from pendingDecisions)
  applyMergerDecision(state, req.user.id, { sell, trade });

  state.log = [{ time: new Date().toISOString(), message: logMsg }, ...(state.log ?? [])].slice(0, 50);

  // Record in the merger_decisions audit table
  const { error: auditError } = await supabase.from('merger_decisions').insert({
    game_id: gameId, defunct_chain: defunct, player_id: req.user.id,
    sell: Number(sell), trade: Number(trade), keep: kept,
  });
  if (auditError) console.error('[merger_decisions]', auditError.message);

  // If all players for this defunct chain have decided, advance the merger
  if (state.mergerContext.pendingDecisions.length === 0) {
    const { phase, bonusLogs } = advanceMerger(state);
    state.log = [
      ...bonusLogs.map(msg => ({ time: new Date().toISOString(), message: msg })),
      ...(state.log ?? []),
    ].slice(0, 50);

    if (phase === 'BUY_STOCKS') {
      state.turnPhase = 'BUY_STOCKS';
      const { canEnd, reason } = checkEndGameConditions(state);
      state.endGameAvailable = canEnd;
      state.endGameReason    = reason ?? null;
      // Restore game status to ACTIVE so the buy-stocks and end-turn routes
      // (which gate on status === 'ACTIVE') will accept the active player's requests.
      // Check the result: if this fails the state save below is skipped, keeping
      // the DB consistent (still MERGER_DECISIONS / MERGER_PAUSE) so the player
      // can retry rather than landing in a split-brain state.
      const { error: statusError } = await supabase
        .from('games')
        .update({ status: 'ACTIVE' })
        .eq('id', gameId);
      if (statusError) {
        console.error('[merger-decision] Failed to restore game status to ACTIVE:', statusError.message);
        return res.status(500).json({ error: 'Merger resolved but failed to update game status. Please retry.' });
      }
    } else {
      state.turnPhase = 'MERGER_DECISIONS'; // another defunct chain to resolve
    }
  }

  const saved = await saveState(gameId, state, playerTiles);
  if (saved.error) return res.status(500).json({ error: saved.error.message });
  res.json({ publicState: saved.publicState, myTiles: playerTiles[req.user.id] ?? [], drawPileCount: saved.drawPile.length });
});

// ============================================================
// POST /api/games/:gameId/declare-end-game
// Active player officially ends the game when end-game conditions are met.
// Triggers final shareholder bonuses + stock liquidation, then declares a winner.
// Only callable during BUY_STOCKS phase when endGameAvailable is true.
// ============================================================
router.post('/:gameId/declare-end-game', async (req, res) => {
  const { gameId } = req.params;

  const { data: game } = await supabase.from('games').select('status').eq('id', gameId).single();
  if (!game || game.status !== 'ACTIVE') return res.status(400).json({ error: 'Game is not active' });

  const loaded = await loadState(gameId);
  if (!loaded) return res.status(500).json({ error: 'Could not load game state' });
  const { state, playerTiles } = loaded;

  const activePlayer = state.players[state.activePlayerIndex];
  if (activePlayer.id !== req.user.id) {
    return res.status(403).json({ error: 'Only the active player can declare game over' });
  }
  if (!state.endGameAvailable) {
    return res.status(400).json({ error: 'End-game conditions have not been met yet' });
  }
  if (state.turnPhase !== 'BUY_STOCKS') {
    return res.status(400).json({ error: 'End game can only be declared during the buy-stocks phase' });
  }

  // Run full end-game payout sequence (bonuses + liquidation + rankings)
  const { logs, winnerId } = executeEndGamePayouts(state);

  state.isGameOver  = true;
  state.winner      = winnerId;
  state.turnPhase   = 'GAME_OVER';
  state.endGameAvailable = false;

  // Prepend all payout log lines (most recent first in our log)
  for (let i = logs.length - 1; i >= 0; i--) {
    state.log = [{ time: new Date().toISOString(), message: logs[i] }, ...(state.log ?? [])].slice(0, 100);
  }

  const saved = await saveState(gameId, state, playerTiles);
  if (saved.error) return res.status(500).json({ error: saved.error.message });

  await supabase.from('games').update({ status: 'COMPLETE' }).eq('id', gameId);

  res.json({ publicState: saved.publicState, myTiles: playerTiles[req.user.id] ?? [], drawPileCount: saved.drawPile.length });
});

// ============================================================
// POST /api/games/:gameId/buy-stocks
// Step 2 of a turn (optional): purchase up to 3 shares.
// Can be called before end-turn. Does NOT end the turn.
//
// Body:
//   stocksBought {object}  — e.g. { "luxor": 2, "tower": 1 }
// ============================================================
router.post('/:gameId/buy-stocks', async (req, res) => {
  const { gameId } = req.params;
  const { stocksBought = {} } = req.body;

  const { data: game } = await supabase
    .from('games').select('status').eq('id', gameId).single();
  if (!game || game.status !== 'ACTIVE') return res.status(400).json({ error: 'Game is not active' });

  const loaded = await loadState(gameId);
  if (!loaded) return res.status(500).json({ error: 'Could not load game state' });
  const { state, playerTiles } = loaded;

  const activePlayer = state.players[state.activePlayerIndex];
  if (activePlayer.id !== req.user.id)   return res.status(403).json({ error: 'It is not your turn' });
  if (state.turnPhase !== 'BUY_STOCKS')  return res.status(400).json({ error: `Wrong phase: currently ${state.turnPhase}` });

  // Convert and validate
  const purchaseList = Object.entries(stocksBought)
    .map(([chainName, quantity]) => ({ chainName, quantity: Number(quantity) }))
    .filter(p => p.quantity > 0);

  if (purchaseList.length > 0) {
    const { valid, error: purchaseError } = validatePurchase(state, req.user.id, purchaseList);
    if (!valid) return res.status(400).json({ error: purchaseError });
    applyPurchase(state, req.user.id, purchaseList);
    const logMsg = `${activePlayer.name} bought ${purchaseList.map(p => `${p.quantity}× ${p.chainName}`).join(', ')}`;
    state.log = [{ time: new Date().toISOString(), message: logMsg }, ...(state.log ?? [])].slice(0, 50);
  }

  const saved = await saveState(gameId, state, playerTiles);
  if (saved.error) return res.status(500).json({ error: saved.error.message });

  res.json({
    publicState: saved.publicState,
    myTiles: playerTiles[req.user.id] ?? [],
    drawPileCount: saved.drawPile.length,
  });
});

// ============================================================
// POST /api/games/:gameId/end-turn
// Step 3 of a turn: optionally buy stocks, draw a replacement
// tile, and pass the turn to the next non-retired player.
//
// Body (all optional):
//   stocksBought {object}  — e.g. { "luxor": 1 } — bought and turn ends
// ============================================================
router.post('/:gameId/end-turn', async (req, res) => {
  const { gameId } = req.params;
  const { stocksBought = {} } = req.body;

  const { data: game } = await supabase
    .from('games').select('status, name').eq('id', gameId).single();
  if (!game || game.status !== 'ACTIVE') return res.status(400).json({ error: 'Game is not active' });

  const loaded = await loadState(gameId);
  if (!loaded) return res.status(500).json({ error: 'Could not load game state' });
  const { state, playerTiles } = loaded;

  const activePlayer = state.players[state.activePlayerIndex];
  if (activePlayer.id !== req.user.id)   return res.status(403).json({ error: 'It is not your turn' });
  if (state.turnPhase !== 'BUY_STOCKS')  return res.status(400).json({ error: `Wrong phase: currently ${state.turnPhase}` });

  // Apply any inline stock purchases (convenience: player can skip buy-stocks step)
  const purchaseList = Object.entries(stocksBought)
    .map(([chainName, quantity]) => ({ chainName, quantity: Number(quantity) }))
    .filter(p => p.quantity > 0);

  if (purchaseList.length > 0) {
    const { valid, error: purchaseError } = validatePurchase(state, req.user.id, purchaseList);
    if (!valid) return res.status(400).json({ error: purchaseError });
    applyPurchase(state, req.user.id, purchaseList);
  }

  // Draw a replacement tile
  const drawn = drawTiles(state.drawPile, 1);
  if (drawn.length > 0) {
    playerTiles[req.user.id] = [...(playerTiles[req.user.id] ?? []), ...drawn];
  }

  // Advance to the next non-retired player
  const numPlayers = state.players.length;
  let nextIdx = state.activePlayerIndex;
  for (let i = 1; i <= numPlayers; i++) {
    nextIdx = (state.activePlayerIndex + i) % numPlayers;
    if (!state.players[nextIdx].isRetired) break;
  }
  if (nextIdx <= state.activePlayerIndex && nextIdx !== state.activePlayerIndex) {
    state.turnNumber += 1;
  }
  state.activePlayerIndex = nextIdx;
  state.turnPhase = 'PLACE_TILE';
  state.hasActedThisTurn = false;

  // Check whether end-game conditions are met after this turn advance
  const { canEnd, reason } = checkEndGameConditions(state);
  state.endGameAvailable = canEnd;
  state.endGameReason    = reason ?? null;

  const nextPlayer = state.players[nextIdx];

  // Auto-replace any tiles in the next player's hand that are permanently unplayable
  // (e.g., tiles that would merge two safe chains — they can never legally be played)
  const nextHand   = playerTiles[nextPlayer.id] ?? [];
  const unplayable = findUnplayableTiles(state, nextHand);
  if (unplayable.length > 0 && state.drawPile.length > 0) {
    playerTiles[nextPlayer.id] = nextHand.filter(t => !unplayable.includes(t));
    const replacements = drawTiles(state.drawPile, unplayable.length);
    playerTiles[nextPlayer.id] = [...playerTiles[nextPlayer.id], ...replacements];
  }
  state.log = [{
    time: new Date().toISOString(),
    message: `Turn passed to ${nextPlayer.name}`,
  }, ...(state.log ?? [])].slice(0, 50);

  const saved = await saveState(gameId, state, playerTiles);
  if (saved.error) return res.status(500).json({ error: saved.error.message });

  // Notify the next player by email
  const { data: nextUser } = await supabase
    .from('users').select('email').eq('id', nextPlayer.id).single();
  if (nextUser?.email) {
    sendTurnNotificationEmail(nextUser.email, game.name, gameId)
      .catch(err => console.error('[email] Failed to send turn notification:', err.message));
  }

  res.json({
    publicState: saved.publicState,
    myTiles: playerTiles[req.user.id] ?? [],
    drawPileCount: saved.drawPile.length,
  });
});

export default router;
