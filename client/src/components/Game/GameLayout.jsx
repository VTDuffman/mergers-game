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
    // Mobile:  full-page natural scroll, no height lock.
    // Desktop: locked to viewport height, internal scrolling per column.
    <div className="flex flex-col min-h-screen xl:h-screen bg-slate-900
                    overflow-y-auto xl:overflow-hidden">

      {/* ── Top bar: whose turn + phase + tile count ── */}
      <TurnBanner />

      {/* ── Main content area ──
          Mobile:  single flex-col. The sidebar wrappers use `display: contents`
                   so their children participate directly in this flex container,
                   allowing arbitrary cross-sidebar ordering via `order-*` classes.
          Desktop: three-column flex-row. The `xl:` overrides restore the sidebar
                   wrappers to normal block/flex containers with fixed widths. */}
      <div className="flex flex-col xl:flex-row xl:flex-1 xl:overflow-hidden p-1 gap-1">

        {/* ── LEFT SIDEBAR: Player list ──
            Mobile:  `contents` — wrapper is invisible to flex layout; its child
                     (the PlayerList div) participates directly in the outer column
                     at order-3 (third from top).
            Desktop: `xl:block` restores it as a normal 288px-wide, full-height,
                     internally-scrolling column at flex order-1. */}
        <div className="contents
                        xl:block xl:order-1 xl:flex-shrink-0 xl:w-72 xl:h-full xl:overflow-y-auto">
          <div className="order-3">
            <PlayerList />
          </div>
        </div>

        {/* ── CENTER COLUMN: Board + Stock buying + Actions + Hand ──
            Always the hero. On mobile it is order-1 (top of page).
            On desktop it is order-2, claims all remaining width (flex-1). */}
        <div className="order-1 xl:order-2
                        xl:flex-1 min-w-0 xl:min-h-0
                        flex flex-col gap-1">
          <GameBoard />
          <StockPanel />
          <ActionPanel />
          <PlayerHand />
        </div>

        {/* ── RIGHT SIDEBAR: Hotel chains + Game log ──
            Mobile:  `contents` — wrapper is invisible to flex layout; children
                     participate directly in the outer column at their own order values.
            Desktop: `xl:flex xl:flex-col` restores it as a normal 320px-wide,
                     full-height, flex column at flex order-3. */}
        <div className="contents
                        xl:flex xl:flex-col xl:order-3 xl:w-80 xl:shrink-0 xl:h-full xl:gap-2 xl:overflow-hidden">

          {/* ChainTable: order-2 on mobile (immediately below the board) */}
          <div className="order-2">
            <ChainTable />
          </div>

          {/* GameLog: order-4 on mobile (bottom of page).
              Mobile:  max-h-64 + overflow-y-auto so it never grows infinitely.
              Desktop: flex-1 + min-h-0 so it fills whatever space ChainTable leaves. */}
          <div className="order-4 max-h-64 overflow-y-auto
                          xl:max-h-none xl:flex-1 xl:min-h-0 xl:overflow-y-auto
                          bg-slate-800 rounded-lg p-2">
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
