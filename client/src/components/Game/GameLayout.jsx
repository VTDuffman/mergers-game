import TurnBanner              from './TurnBanner.jsx';
import GameBoard               from './Board/GameBoard.jsx';
import PlayerHand              from './PlayerHand.jsx';
import PlayerList              from './PlayerList.jsx';
import ChainTable              from './ChainTable.jsx';
import StockPanel              from './StockPanel.jsx';
import GameLog                 from './GameLog.jsx';
import ActionPanel             from './ActionPanel.jsx';
import NameChainDialog         from './Dialogs/NameChainDialog.jsx';
import SurvivorDialog          from './Dialogs/SurvivorDialog.jsx';
import MergerDecisionDialog    from './Dialogs/MergerDecisionDialog.jsx';
import ConfirmMergerDialog     from './Dialogs/ConfirmMergerDialog.jsx';
import ScoreScreen             from '../EndGame/ScoreScreen.jsx';
import useStore                from '../../store.js';

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
      <div className="flex flex-col xl:flex-row flex-1 overflow-hidden p-2 gap-2">

        {/* Left: player list — full-width row on mobile, fixed sidebar on desktop */}
        <div className="flex-shrink-0 xl:w-40 overflow-x-auto xl:overflow-y-auto">
          <PlayerList />
        </div>

        {/* Center: scrollable game board — flex-1 + min-w-0 so it never squishes siblings */}
        <div className="flex-1 min-w-0 overflow-auto flex items-start justify-center">
          <GameBoard />
        </div>

        {/* Right: chain info + stock buying + game log — fixed width so it never compresses */}
        <div className="w-full xl:w-96 xl:shrink-0 flex flex-col gap-2 overflow-hidden
                        xl:max-h-full">
          <ChainTable />
          <StockPanel />
          {/* Game log — takes up remaining vertical space on desktop, fixed height on mobile */}
          <div className="h-32 xl:flex-1 xl:h-auto min-h-0 bg-slate-800 rounded-lg p-2 overflow-hidden">
            <GameLog />
          </div>
        </div>

      </div>

      {/* ── Undo button — shown above the hand when an action can be reversed ── */}
      <ActionPanel />

      {/* ── Bottom: tile hand (sticky on mobile, static on desktop) ── */}
      <PlayerHand />

      {/* ── Overlay dialogs (render on top of everything) ── */}
      <ConfirmMergerDialog />    {/* turnPhase === 'CONFIRM_MERGER'    */}
      <NameChainDialog />        {/* turnPhase === 'NAME_CHAIN'        */}
      <SurvivorDialog />         {/* turnPhase === 'CHOOSE_SURVIVOR'   */}
      <MergerDecisionDialog />   {/* turnPhase === 'MERGER_DECISIONS'  */}
      <ScoreScreen />            {/* isGameOver === true               */}

    </div>
  );
}
