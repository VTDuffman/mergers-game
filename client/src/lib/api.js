import { supabase } from './supabase.js';

/**
 * Core fetch wrapper.
 * Attaches the Supabase JWT from the active session to every request.
 * Throws an Error (with the server's error message) on non-2xx responses.
 *
 * @param {'GET'|'POST'|'DELETE'|'PATCH'} method
 * @param {string} path   - API path, e.g. '/games' or '/games/abc/invite'
 * @param {object} [body] - JSON body for POST/PATCH requests
 */
async function request(method, path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // The server's requireAuth middleware validates this token via Supabase.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({ error: res.statusText }));

  if (!res.ok) {
    throw new Error(json.error || `Request failed: ${res.status}`);
  }

  return json;
}

// ---- Typed API functions used by UI components ----

export const api = {
  // Auth
  getMe: () =>
    request('GET', '/auth/me'),

  // Games / Lobby
  getMyGames: () =>
    request('GET', '/games'),

  createGame: (name) =>
    request('POST', '/games', { name }),

  getGame: (gameId) =>
    request('GET', `/games/${gameId}`),

  invitePlayer: (gameId, email) =>
    request('POST', `/games/${gameId}/invite`, { email }),

  cancelInvite: (gameId, inviteId) =>
    request('DELETE', `/games/${gameId}/invite/${inviteId}`),

  startGame: (gameId) =>
    request('POST', `/games/${gameId}/start`),

  // Invites (invitee perspective)
  getMyInvites: () =>
    request('GET', '/invites'),

  acceptInvite: (inviteId) =>
    request('POST', `/invites/${inviteId}/accept`),

  declineInvite: (inviteId) =>
    request('POST', `/invites/${inviteId}/decline`),

  // Active game — polling
  getGameState: (gameId) =>
    request('GET', `/games/${gameId}/state`),

  // Step 1: place a tile. body = { tilePlaced, chainFounded? }
  playTile: (gameId, body) =>
    request('POST', `/games/${gameId}/play-tile`, body),

  // Step 2: buy stocks (optional). body = { stocksBought: { chainName: qty } }
  buyStocks: (gameId, stocksBought) =>
    request('POST', `/games/${gameId}/buy-stocks`, { stocksBought }),

  // Step 3: end turn. body = { stocksBought? } — stocks here are a convenience shortcut
  endTurn: (gameId, stocksBought = {}) =>
    request('POST', `/games/${gameId}/end-turn`, { stocksBought }),
};
