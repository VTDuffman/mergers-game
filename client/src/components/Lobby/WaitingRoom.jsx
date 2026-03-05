import { useState } from 'react';
import socket from '../../socket.js';
import useStore from '../../store.js';

export default function WaitingRoom() {
  const myPlayerId = useStore(s => s.myPlayerId);
  const roomCode   = useStore(s => s.roomCode);
  const hostId     = useStore(s => s.hostId);
  const players    = useStore(s => s.players);
  const { leaveRoom } = useStore();

  const [copied, setCopied] = useState(false);

  const isHost   = myPlayerId === hostId;
  const canStart = players.length >= 2 && players.length <= 6;

  // The shareable URL — in a real deployment this would be the production URL
  const shareUrl = `${window.location.origin}/room/${roomCode}`;

  function handleCopyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleStart() {
    socket.emit('lobby:start', { playerId: myPlayerId, roomCode });
  }

  function handleKick(targetId) {
    socket.emit('lobby:kick', { playerId: myPlayerId, roomCode, targetPlayerId: targetId });
  }

  function handleLeave() {
    socket.emit('lobby:leave', { playerId: myPlayerId, roomCode });
    leaveRoom();
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12">
      <h1 className="text-4xl font-bold mb-1">Mergers</h1>
      <p className="text-slate-400 mb-8">
        {isHost ? 'Share the code below, then start when everyone is ready.' : 'Waiting for the host to start the game...'}
      </p>

      {/* Room code + copy link */}
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-md mb-4">
        <p className="text-slate-400 text-xs uppercase tracking-widest font-medium mb-3">
          Room Code
        </p>
        <div className="flex items-center gap-4">
          <span className="text-4xl font-mono font-bold tracking-widest text-indigo-400">
            {roomCode}
          </span>
          <button
            onClick={handleCopyLink}
            className="ml-auto text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
        </div>
        <p className="text-slate-600 text-xs mt-2 truncate">{shareUrl}</p>
      </div>

      {/* Player list */}
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-md mb-4">
        <p className="text-slate-400 text-xs uppercase tracking-widest font-medium mb-4">
          Players — {players.length} / 6
        </p>
        <ul className="space-y-3">
          {players.map(player => (
            <li key={player.id} className="flex items-center gap-3">
              {/* Green dot = connected, grey dot = disconnected/reconnecting */}
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${player.isConnected ? 'bg-emerald-400' : 'bg-slate-600'}`} />

              <span className={`flex-1 ${!player.isConnected ? 'text-slate-500' : ''}`}>
                {player.name}
                {player.id === hostId && (
                  <span className="ml-2 text-xs text-amber-400 font-semibold">HOST</span>
                )}
                {player.id === myPlayerId && (
                  <span className="ml-2 text-xs text-slate-500">(you)</span>
                )}
                {!player.isConnected && (
                  <span className="ml-2 text-xs text-slate-600 italic">reconnecting…</span>
                )}
              </span>

              {/* Host can remove other players */}
              {isHost && player.id !== myPlayerId && (
                <button
                  onClick={() => handleKick(player.id)}
                  className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Actions */}
      <div className="w-full max-w-md flex flex-col gap-3">
        {isHost && (
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-4 py-3 font-semibold text-lg transition-colors"
          >
            {players.length < 2
              ? `Need at least 2 players (${players.length}/2)`
              : `Start Game  →`}
          </button>
        )}

        <button
          onClick={handleLeave}
          className="text-slate-500 hover:text-slate-300 text-sm text-center py-1 transition-colors"
        >
          Leave Room
        </button>
      </div>
    </div>
  );
}
