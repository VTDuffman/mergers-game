// NOT IN USE — legacy Socket.io handler from the pre-Supabase architecture.
// All lobby actions now flow through server/routes/invites.js and server/routes/games.js.
// Safe to delete once the Socket.io infrastructure is fully removed.

import {
  createRoom,
  getRoom,
  getRoomBySocketId,
  addPlayer,
  removePlayer,
  updatePlayerSocket,
  setPhase,
} from '../rooms/roomManager.js';
import { createInitialGameState } from '../game/GameState.js';
import { broadcastGameState }     from './gameHandlers.js';

// ---- Helper ----

/**
 * Broadcast the current lobby state to every player in the room.
 * This is called after any change (player joins, leaves, gets kicked, etc.)
 * so all clients immediately see the updated player list.
 */
function broadcastLobby(io, room) {
  io.to(room.code).emit('lobby:update', {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    // Only send public player info — no socketIds
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isConnected: p.isConnected,
    })),
  });
}

// ---- Handler registration ----

export function registerLobbyHandlers(io, socket) {

  /**
   * lobby:create
   * A player opens the app and clicks "Create Room".
   * Server creates the room, adds the creator as host, and sends back the code.
   */
  socket.on('lobby:create', ({ playerId, playerName }) => {
    const name = (playerName || '').trim();
    if (!name || name.length > 20) {
      socket.emit('error', { message: 'Please enter a name (max 20 characters).' });
      return;
    }

    const room = createRoom(playerId, name, socket.id);
    socket.join(room.code);
    socket.emit('lobby:created', { code: room.code });
    broadcastLobby(io, room);
    console.log(`Room ${room.code} created by "${name}"`);
  });

  /**
   * lobby:join
   * A player enters a code and clicks "Join Room".
   * Also handles reconnection: if the playerId is already in the room,
   * we re-attach their new socket instead of adding a duplicate.
   */
  socket.on('lobby:join', ({ playerId, playerName, roomCode }) => {
    const name = (playerName || '').trim();
    const code = (roomCode || '').trim().toUpperCase();

    if (!code || code.length !== 6) {
      socket.emit('error', { message: 'Please enter a valid 6-character room code.' });
      return;
    }

    const room = getRoom(code);
    if (!room) {
      socket.emit('error', { message: `Room "${code}" not found. Check the code and try again.` });
      return;
    }

    // Reconnect: player was already in this room (same playerId stored in sessionStorage)
    const existingPlayer = room.players.find(p => p.id === playerId);
    if (existingPlayer) {
      updatePlayerSocket(code, playerId, socket.id, true);
      socket.join(code);
      socket.emit('lobby:joined', { code, playerId, reconnected: true });

      if (room.phase === 'playing' && room.gameState) {
        // Game is in progress — send them the current game state and their private tiles
        broadcastGameState(io, room);
      } else {
        broadcastLobby(io, room);
      }
      console.log(`"${existingPlayer.name}" reconnected to room ${code}`);
      return;
    }

    // New player — validate name before adding
    if (!name || name.length > 20) {
      socket.emit('error', { message: 'Please enter a name (max 20 characters).' });
      return;
    }

    const result = addPlayer(code, {
      id: playerId,
      name,
      socketId: socket.id,
      isConnected: true,
    });

    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }

    socket.join(code);
    socket.emit('lobby:joined', { code, playerId, reconnected: false });
    broadcastLobby(io, result.room);
    console.log(`"${name}" joined room ${code} (${result.room.players.length}/6 players)`);
  });

  /**
   * lobby:start
   * Host clicks "Start Game".
   * Validates that there are 2–6 players, then flips the room phase to 'playing'.
   * Phase 2 will extend this to initialize game state and deal tiles.
   */
  socket.on('lobby:start', ({ playerId, roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) { socket.emit('error', { message: 'Room not found.' }); return; }
    if (room.hostId !== playerId) { socket.emit('error', { message: 'Only the host can start the game.' }); return; }
    if (room.phase !== 'lobby') { socket.emit('error', { message: 'Game has already started.' }); return; }
    if (room.players.length < 2) { socket.emit('error', { message: 'Need at least 2 players to start.' }); return; }
    if (room.players.length > 6) { socket.emit('error', { message: 'Too many players (max 6).' }); return; }

    setPhase(roomCode, 'playing');

    // Initialize game state: shuffle tiles, deal 6 to each player, set up board
    const { gameState, playerTiles } = createInitialGameState(room.players);
    room.gameState   = gameState;
    room.playerTiles = playerTiles;

    // Broadcast public game state to all players + private tile hands to each individually
    broadcastGameState(io, room);
    console.log(`Room ${roomCode} game started with ${room.players.length} players`);
  });

  /**
   * lobby:kick
   * Host removes another player from the lobby.
   * The kicked player's client will navigate back to the home screen.
   */
  socket.on('lobby:kick', ({ playerId, roomCode, targetPlayerId }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.hostId !== playerId) {
      socket.emit('error', { message: 'Only the host can remove players.' });
      return;
    }
    if (targetPlayerId === playerId) {
      socket.emit('error', { message: 'You cannot remove yourself. Use "Leave Room" instead.' });
      return;
    }

    const target = room.players.find(p => p.id === targetPlayerId);
    if (!target) return;

    // Notify the kicked player's socket directly before removing them
    if (target.socketId) {
      io.to(target.socketId).emit('lobby:kicked', { message: 'You were removed from the room by the host.' });
    }

    const updatedRoom = removePlayer(roomCode, targetPlayerId);
    if (updatedRoom) {
      broadcastLobby(io, updatedRoom);
      console.log(`"${target.name}" was kicked from room ${roomCode}`);
    }
  });

  /**
   * lobby:leave
   * A player voluntarily leaves the room.
   */
  socket.on('lobby:leave', ({ playerId, roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    const updatedRoom = removePlayer(roomCode, playerId);
    socket.leave(roomCode);

    if (updatedRoom) {
      broadcastLobby(io, updatedRoom);
    }
    if (player) console.log(`"${player.name}" left room ${roomCode}`);
  });

  /**
   * disconnect
   * Socket disconnected (browser closed, network drop, etc.)
   * We mark the player as disconnected but do NOT remove them yet,
   * giving them a window to reconnect via lobby:join with the same playerId.
   */
  socket.on('disconnect', () => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    player.isConnected = false;
    broadcastLobby(io, room);
    console.log(`"${player.name}" disconnected from room ${room.code} (may reconnect)`);
  });
}
