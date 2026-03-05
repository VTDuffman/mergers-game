import TurnBanner            from './TurnBanner.jsx';
import GameBoard              from './Board/GameBoard.jsx';
import PlayerHand             from './PlayerHand.jsx';
import PlayerList             from './PlayerList.jsx';
import ChainTable             from './ChainTable.jsx';
import StockPanel             from './StockPanel.jsx';
import GameLog                from './GameLog.jsx';
import NameChainDialog        from './Dialogs/NameChainDialog.jsx';
import SurvivorDialog         from './Dialogs/SurvivorDialog.jsx';
import MergerDecisionDialog   from './Dialogs/MergerDecisionDialog.jsx';
import ScoreScreen            from '../EndGame/ScoreScreen.jsx';
import useStore               from '../../store.js';

export default function GameLayout() {
  const gameState = useStore(s => s.gameState);

  if (!gameState) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-slate-400 text-lg">Loading game…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-900 overflow-hidden">

      {/* ── Top bar: whose turn + phase + tile count ── */}
      <TurnBanner />

      {/* ── Main content ── */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden p-2 gap-2">

        {/* Left: player list — full-width row on mobile, fixed sidebar on desktop */}
        <div className="flex-shrink-0 lg:w-40 overflow-x-auto lg:overflow-y-auto">
          <PlayerList />
        </div>

        {/* Center: scrollable game board */}
        <div className="flex-1 overflow-auto flex items-start justify-center">
          <GameBoard />
        </div>

        {/* Right: chain info + stock buying + game log — stacks below board on mobile */}
        <div className="flex-shrink-0 lg:w-52 flex flex-col gap-2 overflow-hidden
                        lg:max-h-full">
          <ChainTable />
          <StockPanel />
          {/* Game log — takes up remaining vertical space on desktop, fixed height on mobile */}
          <div className="h-32 lg:flex-1 lg:h-auto min-h-0 bg-slate-800 rounded-lg p-2 overflow-hidden">
            <GameLog />
          </div>
        </div>

      </div>

      {/* ── Bottom: tile hand (sticky on mobile, static on desktop) ── */}
      <PlayerHand />

      {/* ── Overlay dialogs (render on top of everything) ── */}
      <NameChainDialog />        {/* turnPhase === 'NAME_CHAIN'        */}
      <SurvivorDialog />         {/* turnPhase === 'CHOOSE_SURVIVOR'   */}
      <MergerDecisionDialog />   {/* turnPhase === 'MERGER_DECISIONS'  */}
      <ScoreScreen />            {/* isGameOver === true               */}

    </div>
  );
}
