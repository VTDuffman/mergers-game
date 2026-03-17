import { useState } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import LoginPage     from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LobbyPage     from './pages/LobbyPage.jsx';
import GamePage      from './pages/GamePage.jsx';

/**
 * Root component. Auth gating + simple state-based router.
 *
 * Routing state:
 *  { page: 'dashboard' }             — home / games list
 *  { page: 'lobby',   gameId }       — pre-game waiting room
 *  { page: 'game',    gameId }       — active game board
 */
export default function App() {
  const { user, loading } = useAuth();

  const [route, setRoute] = useState({ page: 'dashboard' });

  const navigate = {
    toDashboard: () => setRoute({ page: 'dashboard' }),
    toLobby:     (gameId) => setRoute({ page: 'lobby', gameId }),
    toGame:      (gameId) => setRoute({ page: 'game',  gameId }),
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-slate-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  if (route.page === 'lobby') return <LobbyPage gameId={route.gameId} navigate={navigate} />;
  if (route.page === 'game')  return <GamePage  gameId={route.gameId} navigate={navigate} />;

  return <DashboardPage navigate={navigate} />;
}
