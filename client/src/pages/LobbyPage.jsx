import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

// How often to poll for lobby updates (ms).
// Lobby changes are human-speed events (joining, accepting an invite) so 30 s is sufficient.
const POLL_INTERVAL_MS = 30_000;

// Status badge styling for each invite status
const INVITE_STATUS_STYLES = {
  PENDING:  'bg-yellow-500/20 text-yellow-300',
  ACCEPTED: 'bg-green-500/20  text-green-300',
  DECLINED: 'bg-red-500/20    text-red-400',
};

/**
 * LobbyPage — shows the waiting room for a specific game.
 *
 * Props:
 *  gameId   {string}   — UUID of the game to display
 *  navigate {object}   — { toDashboard, toLobby } navigation helpers from App
 */
export default function LobbyPage({ gameId, navigate }) {
  const { user } = useAuth();

  // ---- State ----
  const [game,         setGame]         = useState(null);
  const [players,      setPlayers]      = useState([]);
  const [invites,      setInvites]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [inviteEmail,  setInviteEmail]  = useState('');
  const [inviting,     setInviting]     = useState(false);
  const [starting,     setStarting]     = useState(false);
  const [error,        setError]        = useState('');
  const [successMsg,   setSuccessMsg]   = useState('');

  const isHost = game?.host_id === user?.id;

  // ---- Data loading ----
  const loadLobby = useCallback(async () => {
    try {
      const data = await api.getGame(gameId);
      setGame(data.game);
      setPlayers(data.players);
      setInvites(data.invites);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  // Initial load + auto-poll every POLL_INTERVAL_MS so invite statuses
  // and confirmed player counts stay fresh without a manual browser refresh.
  useEffect(() => {
    loadLobby();
    const intervalId = setInterval(loadLobby, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [loadLobby]);

  // ---- Helper to show a temporary success message ----
  function showSuccess(msg) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  }

  // ---- Actions ----
  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError('');
    try {
      await api.invitePlayer(gameId, inviteEmail.trim());
      setInviteEmail('');
      showSuccess(`Invite sent to ${inviteEmail.trim()}`);
      // Refresh the lobby so the new invite row appears
      loadLobby();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  }

  async function handleCancelInvite(inviteId) {
    setError('');
    try {
      await api.cancelInvite(gameId, inviteId);
      // Remove from local list for instant feedback, then refresh
      setInvites(prev => prev.filter(i => i.id !== inviteId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleStart() {
    setStarting(true);
    setError('');
    try {
      await api.startGame(gameId);
      // Go straight to the game board
      navigate.toGame(gameId);
    } catch (err) {
      setError(err.message);
      setStarting(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this game? This cannot be undone.')) return;
    setError('');
    try {
      await api.deleteGame(gameId);
      navigate.toDashboard();
    } catch (err) {
      setError(err.message);
    }
  }

  // ---- Derived values for the Start button ----
  const pendingInviteCount = invites.filter(i => i.status === 'PENDING').length;
  const confirmedPlayerCount = players.length;

  // Blocked if any invite is still pending or fewer than 2 players have confirmed
  const canStart = isHost
    && game?.status === 'LOBBY'
    && pendingInviteCount === 0
    && confirmedPlayerCount >= 2;

  function getStartBlockReason() {
    if (pendingInviteCount > 0)   return `Waiting for ${pendingInviteCount} invite(s) to be accepted or declined`;
    if (confirmedPlayerCount < 2) return 'At least 2 players must accept to start';
    return '';
  }

  // ---- Render ----
  if (loading) {
    return (
      <div className="min-h-screen bg-black text-slate-200 flex items-center justify-center">
        <p className="text-slate-500 text-sm">Loading lobby…</p>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen bg-black text-slate-200 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || 'Game not found'}</p>
          <button onClick={navigate.toDashboard} className="text-blue-400 underline text-sm">
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-slate-200">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Navigation */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={navigate.toDashboard}
            className="text-slate-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
          >
            ← Back to Dashboard
          </button>
          <button
            onClick={loadLobby}
            className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
            title="Refresh player list and invite statuses"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Game Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-display neon-text text-cyan-400">{game.name}</h1>
              <p className="text-slate-400 text-sm mt-1">
                {game.status === 'LOBBY' ? 'Waiting for players…' : `Status: ${game.status}`}
              </p>
            </div>

            {/* Host actions — Start and Delete */}
            {isHost && game.status === 'LOBBY' && (
              <div className="text-right flex-shrink-0 flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    className="bg-red-900/60 hover:bg-red-700 text-red-300 hover:text-white font-medium px-4 py-2.5 rounded-lg transition-colors text-sm"
                  >
                    Delete Game
                  </button>
                  <button
                    onClick={handleStart}
                    disabled={!canStart || starting}
                    title={!canStart ? getStartBlockReason() : ''}
                    className="bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-lg transition-colors neon-glow-green"
                  >
                    {starting ? 'Starting…' : 'Start Game'}
                  </button>
                </div>
                {!canStart && (
                  <p className="text-slate-500 text-xs max-w-[220px]">
                    {getStartBlockReason()}
                  </p>
                )}
              </div>
            )}

            {(game.status === 'ACTIVE' || game.status === 'MERGER_PAUSE') && (
              <button
                onClick={() => navigate.toGame(gameId)}
                className="bg-green-600 hover:bg-green-500 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors flex-shrink-0 neon-glow-green"
              >
                {game.status === 'MERGER_PAUSE' ? 'Merger in Progress →' : 'Enter Game →'}
              </button>
            )}
          </div>
        </div>

        {/* Error / Success messages */}
        {error && (
          <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 mb-6 text-sm">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="bg-green-900/40 border border-green-700 text-green-300 rounded-lg px-4 py-3 mb-6 text-sm">
            {successMsg}
          </div>
        )}

        {/* Confirmed Players */}
        <section className="mb-8">
          <h2 className="text-slate-400 mb-3 uppercase tracking-widest text-[10px] font-display">
            Players ({confirmedPlayerCount})
          </h2>
          <div className="space-y-2">
            {players.map(player => (
              <div
                key={player.id}
                className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 flex items-center gap-3"
              >
                {player.users?.avatar_url ? (
                  <img
                    src={player.users.avatar_url}
                    alt=""
                    className="w-8 h-8 rounded-full border border-slate-600"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold">
                    {(player.users?.display_name ?? '?')[0].toUpperCase()}
                  </div>
                )}
                <span className="font-medium flex-1">
                  {player.users?.display_name ?? player.users?.email ?? 'Unknown'}
                </span>
                {player.user_id === game.host_id && (
                  <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded">
                    Host
                  </span>
                )}
                {player.user_id === user?.id && (
                  <span className="text-xs text-blue-400">You</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Invitations */}
        {invites.length > 0 && (
          <section className="mb-8">
            <h2 className="text-slate-400 mb-3 uppercase tracking-widest text-[10px] font-display">
              Invitations ({invites.length})
            </h2>
            <div className="space-y-2">
              {invites.map(invite => (
                <div
                  key={invite.id}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {invite.invitee_email[0].toUpperCase()}
                    </div>
                    <span className="text-slate-300 text-sm truncate">
                      {invite.invitee_email}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${INVITE_STATUS_STYLES[invite.status]}`}>
                      {invite.status.charAt(0) + invite.status.slice(1).toLowerCase()}
                    </span>
                    {/* Host can cancel pending invites */}
                    {isHost && invite.status === 'PENDING' && (
                      <button
                        onClick={() => handleCancelInvite(invite.id)}
                        className="text-slate-500 hover:text-red-400 text-xs transition-colors"
                        title="Cancel invite"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Invite Form — host only, game still in LOBBY */}
        {isHost && game.status === 'LOBBY' && (
          <section>
            <h2 className="text-slate-400 mb-3 uppercase tracking-widest text-[10px] font-display">
              Invite a Player
            </h2>
            <form onSubmit={handleInvite} className="flex gap-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="friend@example.com"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
              />
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium px-5 py-2.5 rounded-lg transition-colors flex-shrink-0 neon-glow-cyan"
              >
                {inviting ? 'Sending…' : 'Send Invite'}
              </button>
            </form>
            <p className="text-slate-500 text-xs mt-2">
              An email will be sent with a link to join. Up to 6 players total.
            </p>
          </section>
        )}

      </div>
    </div>
  );
}
