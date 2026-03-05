import { create } from 'zustand';

/**
 * Generate a persistent player ID for this browser session.
 * Stored in sessionStorage so it survives page refreshes but not new tabs.
 * This is how the server identifies a reconnecting player.
 */
function getOrCreatePlayerId() {
  let id = sessionStorage.getItem('playerId');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('playerId', id);
  }
  return id;
}

const useStore = create((set, get) => ({
  // ---- My identity ----
  myPlayerId: getOrCreatePlayerId(),
  myName: '',

  // ---- Room state (kept in sync with the server) ----
  roomCode: null,
  hostId: null,
  // 'home'     → on the landing page, not in a room
  // 'lobby'    → in a room, waiting for the host to start
  // 'playing'  → game is in progress (game UI, Phase 2+)
  // 'game_over'→ game has ended (score screen, Phase 5+)
  phase: 'home',
  players: [],        // [{ id, name, isConnected }]

  // ---- UI state ----
  errorMessage: null,

  // ---- Actions ----

  setMyName: (name) => set({ myName: name }),

  setErrorMessage: (msg) => set({ errorMessage: msg }),
  clearError: () => set({ errorMessage: null }),

  // Server confirmed our room was created — move to lobby view
  onRoomCreated: (code) => set({ roomCode: code, phase: 'lobby' }),

  // Server broadcast an updated lobby state (called on every player join/leave/kick)
  onLobbyUpdate: (data) => set({
    roomCode: data.code,
    hostId: data.hostId,
    // If the server says 'playing', switch to playing view; otherwise stay in lobby
    phase: data.phase === 'playing' ? 'playing' : 'lobby',
    players: data.players,
  }),

  // We were kicked by the host — go back to home with an error message
  onKicked: (message) => set({
    roomCode: null,
    hostId: null,
    phase: 'home',
    players: [],
    errorMessage: message,
  }),

  // We chose to leave — go back to home cleanly
  leaveRoom: () => set({
    roomCode: null,
    hostId: null,
    phase: 'home',
    players: [],
    errorMessage: null,
  }),
}));

export default useStore;
