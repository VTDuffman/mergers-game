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
    // On mobile: allow full-page scroll so nothing gets crushed.
    // On xl desktop: lock to viewport height and use internal scrolling per column.
    <div className="flex flex-col min-h-screen xl:h-screen bg-slate-900
                    overflow-y-auto xl:overflow-hidden">

      {/* ── Top bar: whose turn + phase + tile count ── */}
      <TurnBanner />

      {/* ── Main content area ──
          Mobile:  single column, flex-col. Items stack in DOM order, but we use
                   Tailwind `order-*` utilities to force Center → Left → Right.
          Desktop: three-column row that fills the remaining viewport height. */}
      <div className="flex flex-col xl:flex-row xl:flex-1 xl:overflow-hidden p-1 gap-1">

        {/* ── LEFT SIDEBAR: Player list ──
            Mobile:  order-2 (rendered below the board), rigid h-80, scrolls internally.
            Desktop: order-1, fixed 288px wide, fills column height, scrolls internally. */}
        <div className="order-2 xl:order-1
                        flex-shrink-0 w-full xl:w-72
                        h-80 xl:h-full
                        overflow-y-auto">
          <PlayerList />
        </div>

        {/* ── CENTER COLUMN: Board + Hand + Actions ──
            This is the hero element. It renders FIRST on every screen size.
            Mobile:  order-1 (top of page), natural height, no overflow clipping.
            Desktop: order-2, flex-1 (claims all remaining width), min-h-0 so
                     the flex child can shrink without overflow. */}
        <div className="order-1 xl:order-2
                        xl:flex-1 min-w-0 min-h-0
                        flex flex-col gap-1">
          <GameBoard />
          <PlayerHand />
          <ActionPanel />
        </div>

        {/* ── RIGHT SIDEBAR: Chain info + Stock buying + Game log ──
            Mobile:  order-3 (rendered below the board), rigid h-80, scrolls internally.
            Desktop: order-3, fixed 320px wide, fills column height. */}
        <div className="order-3
                        w-full xl:w-80 xl:shrink-0
                        h-80 xl:h-full
                        flex flex-col gap-2
                        overflow-y-auto xl:overflow-hidden">
          <ChainTable />
          <StockPanel />

          {/* Game log: fixed height on mobile, fills leftover space on desktop */}
          <div className="h-32 xl:flex-1 xl:h-auto min-h-0
                          bg-slate-800 rounded-lg p-2 overflow-hidden">
            <GameLog />
          </div>
        </div>

      </div>

      {/* ── Overlay dialogs (render on top of everything) ── */}
      <ConfirmMergerDialog />    {/* turnPhase === 'CONFIRM_MERGER'    */}
      <NameChainDialog />        {/* turnPhase === 'NAME_CHAIN'        */}
      <SurvivorDialog />         {/* turnPhase === 'CHOOSE_SURVIVOR'   */}
      <MergerDecisionDialog />   {/* turnPhase === 'MERGER_DECISIONS'  */}
      <ScoreScreen />            {/* isGameOver === true               */}

    </div>
  );
}
