import TurnBanner            from './TurnBanner.jsx';
import GameBoard              from './Board/GameBoard.jsx';
import PlayerHand             from './PlayerHand.jsx';
import PlayerList             from './PlayerList.jsx';
import ChainTable             from './ChainTable.jsx';
import StockPanel             from './StockPanel.jsx';
import NameChainDialog        from './Dialogs/NameChainDialog.jsx';
import SurvivorDialog         from './Dialogs/SurvivorDialog.jsx';
import MergerDecisionDialog   from './Dialogs/MergerDecisionDialog.jsx';
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
      <div className="flex flex-1 overflow-hidden p-2 gap-2">

        {/* Left: player list */}
        <div className="w-40 flex-shrink-0 overflow-y-auto">
          <PlayerList />
        </div>

        {/* Center: scrollable game board */}
        <div className="flex-1 overflow-auto flex items-start justify-center">
          <GameBoard />
        </div>

        {/* Right: chain info + stock buying (hidden on small screens) */}
        <div className="w-52 flex-shrink-0 hidden lg:flex flex-col overflow-y-auto gap-2">
          <ChainTable />
          <StockPanel />
        </div>

      </div>

      {/* ── Bottom: tile hand (always visible) ── */}
      <PlayerHand />

      {/* ── Overlay dialogs (render on top of everything) ── */}
      <NameChainDialog />        {/* turnPhase === 'NAME_CHAIN'        */}
      <SurvivorDialog />         {/* turnPhase === 'CHOOSE_SURVIVOR'   */}
      <MergerDecisionDialog />   {/* turnPhase === 'MERGER_DECISIONS'  */}

    </div>
  );
}
