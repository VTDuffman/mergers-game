import { useEffect } from 'react';
import socket from './socket.js';
import useStore from './store.js';
import HomePage from './components/Lobby/HomePage.jsx';
import WaitingRoom from './components/Lobby/WaitingRoom.jsx';

export default function App() {
  const phase = useStore(s => s.phase);
  const { onRoomCreated, onLobbyUpdate, onKicked, setErrorMessage } = useStore();

  useEffect(() => {
    // Open the WebSocket connection when the app first loads
    socket.connect();

    // ---- Listen for messages from the server ----

    // Server confirmed: room was created, here is the code
    socket.on('lobby:created', ({ code }) => {
      onRoomCreated(code);
    });

    // Server broadcast: lobby player list changed (someone joined, left, was kicked, etc.)
    socket.on('lobby:update', (data) => {
      onLobbyUpdate(data);
    });

    // Server confirmed: we successfully joined a room (nothing extra to do here —
    // the 'lobby:update' event that follows will set the room state)
    socket.on('lobby:joined', () => {});

    // Server: we were removed from the room by the host
    socket.on('lobby:kicked', ({ message }) => {
      onKicked(message);
    });

    // Server: something we tried to do was invalid
    socket.on('error', ({ message }) => {
      setErrorMessage(message);
    });

    // Clean up listeners when the component unmounts (prevents duplicates)
    return () => {
      socket.off('lobby:created');
      socket.off('lobby:update');
      socket.off('lobby:joined');
      socket.off('lobby:kicked');
      socket.off('error');
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {phase === 'home'    && <HomePage />}
      {phase === 'lobby'   && <WaitingRoom />}

      {/* Game board — built in Phase 2 */}
      {phase === 'playing' && (
        <div className="flex items-center justify-center h-screen">
          <p className="text-slate-400 text-xl">Game board coming in Phase 2...</p>
        </div>
      )}
    </div>
  );
}
