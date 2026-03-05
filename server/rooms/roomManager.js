import { customAlphabet } from 'nanoid';

// Room codes use only unambiguous characters (no 0/O, no 1/I)
const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// All active rooms, keyed by room code.
// Structure: Map<string, Room>
// Room shape: { code, hostId, phase, lastActivity, players: Player[] }
// Player shape: { id, name, socketId, isConnected }
const rooms = new Map();

// ----- Cleanup: delete rooms inactive for 2 hours -----
const TWO_HOURS = 2 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > TWO_HOURS) {
      rooms.delete(code);
      console.log(`Room ${code} expired and was cleaned up.`);
    }
  }
}, 60_000); // check every minute

// ----- Exported functions -----

/** Create a brand new room with the host as the first player. */
export function createRoom(hostId, hostName, hostSocketId) {
  // Keep generating until we get a code that isn't already in use
  let code;
  do { code = generateCode(); } while (rooms.has(code));

  const room = {
    code,
    hostId,
    phase: 'lobby',       // 'lobby' | 'playing' | 'game_over'
    lastActivity: Date.now(),
    players: [
      { id: hostId, name: hostName, socketId: hostSocketId, isConnected: true },
    ],
    gameState: null,      // filled in when the game starts (Phase 2+)
  };

  rooms.set(code, room);
  return room;
}

/** Look up a room by its code. Returns null if not found. */
export function getRoom(code) {
  return rooms.get(code) ?? null;
}

/** Find which room a given player ID is in. Returns null if not found. */
export function getRoomByPlayerId(playerId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.id === playerId)) return room;
  }
  return null;
}

/** Find which room a given socket ID is in. Returns null if not found. */
export function getRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return null;
}

/**
 * Add a new player to a room.
 * Returns { room } on success or { error: string } on failure.
 */
export function addPlayer(code, player) {
  const room = rooms.get(code);
  if (!room)                          return { error: 'Room not found.' };
  if (room.phase !== 'lobby')         return { error: 'Game already in progress.' };
  if (room.players.length >= 6)       return { error: 'Room is full (maximum 6 players).' };
  if (room.players.some(p => p.id === player.id)) return { error: 'Already in this room.' };

  room.players.push(player);
  room.lastActivity = Date.now();
  return { room };
}

/** Update a player's socket ID and connection status (used for reconnects). */
export function updatePlayerSocket(code, playerId, socketId, isConnected) {
  const room = rooms.get(code);
  if (!room) return;
  const player = room.players.find(p => p.id === playerId);
  if (player) {
    player.socketId = socketId;
    player.isConnected = isConnected;
    room.lastActivity = Date.now();
  }
}

/**
 * Remove a player from a room.
 * If the host leaves, the next player becomes host.
 * If the room becomes empty, it is deleted.
 * Returns the updated room, or null if the room was deleted.
 */
export function removePlayer(code, playerId) {
  const room = rooms.get(code);
  if (!room) return null;

  room.players = room.players.filter(p => p.id !== playerId);

  if (room.players.length === 0) {
    rooms.delete(code);
    return null;
  }

  // If the host left, promote the next player in the list
  if (room.hostId === playerId) {
    room.hostId = room.players[0].id;
  }

  room.lastActivity = Date.now();
  return room;
}

/** Change a room's phase ('lobby' → 'playing' → 'game_over'). */
export function setPhase(code, phase) {
  const room = rooms.get(code);
  if (!room) return;
  room.phase = phase;
  room.lastActivity = Date.now();
}

/** Touch a room's lastActivity timestamp to prevent cleanup. */
export function touchRoom(code) {
  const room = rooms.get(code);
  if (room) room.lastActivity = Date.now();
}
