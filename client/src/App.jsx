import { useEffect } from 'react';
import socket from './socket.js';
import useStore from './store.js';
import HomePage   from './components/Lobby/HomePage.jsx';
import WaitingRoom from './components/Lobby/WaitingRoom.jsx';
import GameLayout  from './components/Game/GameLayout.jsx';

export default function App() {
  const phase = useStore(s => s.phase);
  const { onRoomCreated, onLobbyUpdate, onKicked, setErrorMessage,
          onGameStateUpdate, onMyTilesUpdate } = useStore();

  useEffect(() => {
    // Open the WebSocket connection when the app first loads
    socket.connect();

    // ---- Lobby events ----

    socket.on('lobby:created', ({ code }) => onRoomCreated(code));

    // Player list changed (join / leave / kick / reconnect)
    socket.on('lobby:update', (data) => onLobbyUpdate(data));

    // Confirmed we joined — the lobby:update that follows will set the room state
    socket.on('lobby:joined', () => {});

    socket.on('lobby:kicked', ({ message }) => onKicked(message));

    // ---- Game events (Phase 2+) ----

    // Server broadcast the full public game state after every action
    socket.on('game:stateUpdate', (gs) => onGameStateUpdate(gs));

    // Server sent our private tile hand (only to us, not other players)
    socket.on('game:tilesUpdate', (tiles) => onMyTilesUpdate(tiles));

    // ---- Generic error ----
    socket.on('error', ({ message }) => setErrorMessage(message));

    return () => {
      socket.off('lobby:created');
      socket.off('lobby:update');
      socket.off('lobby:joined');
      socket.off('lobby:kicked');
      socket.off('game:stateUpdate');
      socket.off('game:tilesUpdate');
      socket.off('error');
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {phase === 'home'    && <HomePage />}
      {phase === 'lobby'   && <WaitingRoom />}
      {phase === 'playing' && <GameLayout />}
    </div>
  );
}
