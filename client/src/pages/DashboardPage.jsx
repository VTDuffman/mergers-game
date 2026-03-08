import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

// Badge colors for each game status
const STATUS_STYLES = {
  LOBBY:         'bg-yellow-500/20 text-yellow-300',
  ACTIVE:        'bg-green-500/20  text-green-300',
  MERGER_PAUSE:  'bg-orange-500/20 text-orange-300',
  COMPLETE:      'bg-slate-500/20  text-slate-400',
};

const STATUS_LABELS = {
  LOBBY:         'In Lobby',
  ACTIVE:        'Active',
  MERGER_PAUSE:  'Merger Pause',
  COMPLETE:      'Complete',
};

export default function DashboardPage({ navigate }) {
  const { user, signOut } = useAuth();

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Player';
  const avatarUrl   = user?.user_metadata?.avatar_url;

  // ---- State ----
  const [games,        setGames]        = useState([]);
  const [invites,      setInvites]      = useState([]);
  const [loadingData,  setLoadingData]  = useState(true);
  const [newGameName,  setNewGameName]  = useState('');
  const [creating,     setCreating]     = useState(false);
  const [error,        setError]        = useState('');

  // ---- Data loading ----
  const loadData = useCallback(async () => {
    try {
      const [gamesData, invitesData] = await Promise.all([
        api.getMyGames(),
        api.getMyInvites(),
      ]);
      setGames(gamesData);
      setInvites(invitesData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ---- Actions ----
  async function handleCreateGame(e) {
    e.preventDefault();
    if (!newGameName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const game = await api.createGame(newGameName.trim());
      setNewGameName('');
      navigate.toLobby(game.id);
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  }

  async function handleAccept(inviteId) {
    setError('');
    try {
      const result = await api.acceptInvite(inviteId);
      navigate.toLobby(result.gameId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteGame(gameId) {
    if (!window.confirm('Delete this game? This cannot be undone.')) return;
    setError('');
    try {
      await api.deleteGame(gameId);
      setGames(prev => prev.filter(g => g.id !== gameId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDecline(inviteId) {
    setError('');
    try {
      await api.declineInvite(inviteId);
      // Remove from local list immediately for snappy feedback
      setInvites(prev => prev.filter(i => i.id !== inviteId));
    } catch (err) {
      setError(err.message);
    }
  }

  // ---- Render ----
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Hotel Shenanigans</h1>
          <div className="flex items-center gap-3">
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt="Profile"
                className="w-9 h-9 rounded-full border-2 border-slate-600"
              />
            )}
            <span className="text-slate-300 text-sm hidden sm:block">{displayName}</span>
            <button
              onClick={signOut}
              className="text-slate-400 hover:text-white text-sm underline transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Global error */}
        {error && (
          <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Pending Invites */}
        {invites.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              Pending Invitations
              <span className="bg-blue-500 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {invites.length}
              </span>
            </h2>
            <div className="space-y-3">
              {invites.map(invite => (
                <div
                  key={invite.id}
                  className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-medium">{invite.games?.name ?? 'A game'}</p>
                    <p className="text-slate-400 text-sm mt-0.5">
                      Invited {new Date(invite.invited_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleAccept(invite.id)}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleDecline(invite.id)}
                      className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Create Game */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Create a New Game</h2>
          <form onSubmit={handleCreateGame} className="flex gap-3">
            <input
              type="text"
              value={newGameName}
              onChange={e => setNewGameName(e.target.value)}
              placeholder="Game name (e.g. Friday Night Game)"
              maxLength={60}
              className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button
              type="submit"
              disabled={creating || !newGameName.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-lg transition-colors flex-shrink-0"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
        </section>

        {/* My Games */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Your Games</h2>

          {loadingData ? (
            <p className="text-slate-500 text-sm">Loading…</p>
          ) : games.length === 0 ? (
            <p className="text-slate-500 text-sm">
              No games yet. Create one above, or accept an invitation to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {games.map(game => (
                <div key={game.id} className="flex items-center gap-2">
                  <button
                    onClick={() => game.status === 'ACTIVE' ? navigate.toGame(game.id) : navigate.toLobby(game.id)}
                    className="flex-1 bg-slate-800 border border-slate-700 hover:border-slate-500 rounded-xl p-4 flex items-center justify-between gap-4 text-left transition-colors"
                  >
                    <div>
                      <p className="font-medium">{game.name}</p>
                      <p className="text-slate-500 text-sm mt-0.5">
                        {new Date(game.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[game.status] ?? STATUS_STYLES.COMPLETE}`}>
                      {STATUS_LABELS[game.status] ?? game.status}
                    </span>
                  </button>
                  {/* Delete button — host only, LOBBY only */}
                  {game.host_id === user?.id && game.status === 'LOBBY' && (
                    <button
                      onClick={() => handleDeleteGame(game.id)}
                      className="text-slate-600 hover:text-red-400 transition-colors p-2 flex-shrink-0"
                      title="Delete game"
                    >
                      🗑
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
