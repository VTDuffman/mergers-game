import { useState, useEffect } from 'react';
import socket from '../../socket.js';
import useStore from '../../store.js';

export default function HomePage() {
  const myPlayerId  = useStore(s => s.myPlayerId);
  const errorMessage = useStore(s => s.errorMessage);
  const { setMyName, clearError } = useStore();

  const [createName, setCreateName] = useState('');
  const [joinName,   setJoinName]   = useState('');
  const [joinCode,   setJoinCode]   = useState('');

  // Clear any error left over from a previous action (e.g. being kicked)
  useEffect(() => { clearError(); }, []);

  function handleCreate(e) {
    e.preventDefault();
    clearError();
    const name = createName.trim();
    if (!name) return;
    setMyName(name);
    socket.emit('lobby:create', { playerId: myPlayerId, playerName: name });
  }

  function handleJoin(e) {
    e.preventDefault();
    clearError();
    const name = joinName.trim();
    const code = joinCode.trim().toUpperCase();
    if (!name || code.length !== 6) return;
    setMyName(name);
    socket.emit('lobby:join', { playerId: myPlayerId, playerName: name, roomCode: code });
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12">
      <h1 className="text-5xl font-bold tracking-tight mb-2">Mergers</h1>
      <p className="text-slate-400 mb-10 text-center max-w-xs">
        The classic hotel-chain board game, now online.
      </p>

      {/* Server error message */}
      {errorMessage && (
        <div className="mb-6 px-4 py-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm max-w-sm w-full text-center">
          {errorMessage}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6 w-full max-w-2xl">

        {/* --- Create a Room --- */}
        <form
          onSubmit={handleCreate}
          className="bg-slate-800 rounded-2xl p-6 flex flex-col gap-4"
        >
          <div>
            <h2 className="text-xl font-semibold">Create a Room</h2>
            <p className="text-slate-400 text-sm mt-1">
              Start a new game and share the code with friends.
            </p>
          </div>
          <input
            type="text"
            placeholder="Your name"
            maxLength={20}
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            className="bg-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 transition"
          />
          <button
            type="submit"
            disabled={!createName.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-4 py-2.5 font-semibold transition-colors"
          >
            Create Room
          </button>
        </form>

        {/* --- Join a Room --- */}
        <form
          onSubmit={handleJoin}
          className="bg-slate-800 rounded-2xl p-6 flex flex-col gap-4"
        >
          <div>
            <h2 className="text-xl font-semibold">Join a Room</h2>
            <p className="text-slate-400 text-sm mt-1">
              Have a code? Enter it below to join.
            </p>
          </div>
          <input
            type="text"
            placeholder="Your name"
            maxLength={20}
            value={joinName}
            onChange={e => setJoinName(e.target.value)}
            className="bg-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 transition"
          />
          <input
            type="text"
            placeholder="Room code  (e.g. K7XM2P)"
            maxLength={6}
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            className="bg-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-emerald-500 font-mono tracking-widest uppercase transition"
          />
          <button
            type="submit"
            disabled={!joinName.trim() || joinCode.trim().length !== 6}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-4 py-2.5 font-semibold transition-colors"
          >
            Join Room
          </button>
        </form>
      </div>
    </div>
  );
}
