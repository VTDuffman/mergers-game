# Mergers — Code Analysis & Polish Roadmap

> Generated: 2026-04-05
> Scope: Full codebase review — bugs, performance, UX gaps, security, and razzle-dazzle opportunities
> No code was changed during this analysis. Everything below is findings only.

---

## How to Read This Document

Findings are grouped by category and ranked **P1–P4** within each:

| Priority | Meaning |
|----------|---------|
| **P1** | Game-breaking / data-loss risk — fix before next playtest |
| **P2** | High impact — fix before calling this a "finished" game |
| **P3** | Notable improvement — tackle in a polish sprint |
| **P4** | Nice-to-have / razzle-dazzle — do when time permits |

---

## SECTION 1 — BUGS

### [P1] Game status out-of-sync can silently kill a session
**File:** `server/routes/games.js` — `merger-decision` route
**What happens:** When the last merger decision is resolved and the turn advances to `BUY_STOCKS`, the server saves `turnPhase: 'BUY_STOCKS'` to `game_states` AND updates `games.status` to `'ACTIVE'`. If the `game_states` save succeeds but the `games.status` update fails silently (network blip, Supabase timeout), the state is out of sync. The game then rejects all `buy-stocks` and `end-turn` requests with "Game is not active" — and the session is permanently stuck with no visible error to players.
**Status:** Partially fixed in a prior session (error-checking was added to `play-tile`, `choose-survivor`, and `merger-decision`). Recommend a full audit of every `supabase.from('games').update(...)` call in the file to confirm all of them check `{ error }` and return 500 before saving game state.
**Fix:** Grep for `games').update` and verify every call has a corresponding `if (statusError) return res.status(500)...` guard.

---

### [P1] Merger concurrent-request race condition
**File:** `server/routes/games.js` — `merger-decision` route
**What happens:** During `MERGER_DECISIONS`, the server checks `pendingDecisions[0]` to determine whose turn it is. If two players (or one player's browser sending a double-request due to a network retry) submit simultaneously, both requests can pass the "is it your turn?" check before either one mutates the queue. The result is corrupted decision state, potentially awarding bonuses twice or skipping a player.
**Fix:** Add a simple per-game lock variable (e.g., `processingMergerDecision: false` on the state object). Set it to `true` at the start of the handler and `false` at the end. If a request arrives while `processingMergerDecision` is `true`, return a 409 Conflict so the client can retry cleanly.

---

### [P2] Draw pile exhaustion is silent
**File:** `server/game/tileLogic.js`
**What happens:** When the draw pile runs out, `drawTile()` returns `undefined` or an empty result. The backend does not explicitly check for this. The client would receive a hand with fewer than the expected number of tiles, and the player would see tiles disappear from their rack with no explanation. Worse, a player with 0 tiles and no legal moves could get soft-locked on the PLACE_TILE phase.
**Fix:** After drawing, if `drawPile.length === 0` AND the player has 0 legal tiles, automatically invoke `checkEndGameConditions` and trigger the end-game payout. Add a log entry: "The tile bag is empty."

---

### [P2] Bonus split rounding can overpay by up to $99
**File:** `server/game/mergerLogic.js`
**What happens:** The `roundUp100` function rounds each individual share of a split bonus upward to the nearest $100. With 3 players splitting a $500 bonus: $500 / 3 = $166.67, rounded up = $200 each → bank pays out $600 instead of $500.
**Note:** This is actually *generous* to players at the bank's expense, which is arguably fine for a casual game. But it diverges from official Acquire rules, which say: divide equally, round up, excess goes to the bank.
**Fix:** Decide intentionally. If you want strict rules: distribute floor amount to all, give remainder to the first-in-turn-order player. If you want to keep the current behavior, document it as a house rule.

---

### [P2] Log auto-scroll fights the user
**File:** `client/src/pages/GamePage.jsx` — game log panel
**What happens:** The new game log (added in 6b) auto-scrolls to the bottom every time `log.length` changes. If a player has scrolled up to read history, the next poll will yank them back to the bottom. This is the #1 most annoying behavior in chat-style UIs.
**Fix:** Only auto-scroll if the user is already at (or near) the bottom. Check `logRef.current.scrollHeight - logRef.current.scrollTop - logRef.current.clientHeight < 40` before scrolling. Add a small "↓ New" badge that appears when the log is scrolled up and a new entry arrives.

---

### [P3] Retired players still show on the active-player cycle in the UI
**File:** `client/src/pages/GamePage.jsx` — TurnBanner, footer
**What happens:** `activePlayer` is derived from `publicState.players[publicState.activePlayerIndex]`. If a retired player is skipped server-side but the client still renders their name briefly as "Waiting for X" during the poll gap, it creates a confusing flash.
**Fix:** Filter `publicState.players` for `!p.isRetired` before displaying in the "Waiting for..." banner. The server already handles skipping; this is purely a display polish.

---

### [P3] No handling for stale session after server restart
**File:** `client/src/pages/GamePage.jsx` — polling error handler
**What happens:** If the server restarts mid-game (Railway deploy, crash recovery), polled requests will fail. The current handler sets a `pollError` banner but keeps retrying forever. Players have no guidance on what to do.
**Fix:** After 5 consecutive failed polls, show a more prominent message: "Connection lost — the server may be restarting. Your game is saved. Refresh to reconnect." Include a "Refresh Now" button.

---

## SECTION 2 — SECURITY

### [P2] No rate limiting on game action endpoints
**File:** `server/routes/games.js`
**Issue:** A buggy or malicious client can fire `POST /play-tile` hundreds of times per second. Since each request reads and writes to Supabase, this can exhaust database connections and generate significant cost.
**Fix:** Add `express-rate-limit` middleware scoped to `/api/games` routes. Suggested: max 10 requests per player per 10 seconds. This is a one-hour implementation.

---

### [P3] Game name not sanitized
**File:** `server/routes/games.js` — `POST /games` route
**Issue:** Game names are trimmed but not stripped of HTML/special characters. Names are only shown to authenticated users, so XSS risk is low. But injecting `<script>` or very long strings could cause display issues.
**Fix:** Add a simple `.replace(/[<>&"]/g, '')` strip and enforce the 60-character max length on the server (it's currently only enforced on the frontend `maxLength` attribute, which is trivially bypassed via API).

---

### [P3] Client-side tile validation is advisory only — but divergence could confuse users
**File:** `client/src/pages/GamePage.jsx` — `classifyTile()`
**Issue:** The frontend duplicates tile classification logic from `server/game/boardLogic.js` for UX highlighting purposes. If a bug causes the client to show a tile as playable when the server rejects it (or vice versa), the player will click a tile, see the spinner, and get an error — with no indication why the tile appeared playable.
**Fix:** When the server rejects a `play-tile` with a 400 error, display the server's error message clearly on the tile or in a toast. The current error handling shows it in an `actionError` banner, which is fine — just make sure the message is human-readable (e.g., "That tile would merge two safe chains" rather than "ILLEGAL_TILE").

---

## SECTION 3 — PERFORMANCE

### [P3] Board tile classifications recomputed on every render
**File:** `client/src/pages/GamePage.jsx`, lines ~310–320
**Issue:** `tileClassifications` is a plain object computed inline during render. It runs `classifyTile()` for every tile in the player's hand (up to 6 calls) on every re-render — including state changes that have nothing to do with the board (e.g., `mergerSell` input changes, hover states). Not a bottleneck on desktop, but measurable on older phones.
**Fix:** Wrap in `useMemo(() => {...}, [publicState?.board, publicState?.chains, myTiles])`. One-line change.

---

### [P3] Lobby polling interval is too aggressive
**File:** `client/src/pages/LobbyPage.jsx`, line 7
**Issue:** `POLL_INTERVAL_MS = 10_000` means every player in a lobby polls every 10 seconds. The lobby only needs to show invite status changes (which are human-speed events). 30 seconds is perfectly acceptable here.
**Fix:** Change `10_000` to `30_000`.

---

### [P3] AnimatedDollar can jump mid-animation
**File:** `client/src/pages/GamePage.jsx` — `AnimatedDollar` component
**Issue:** If a player's cash changes between two consecutive polls (e.g., they receive a bonus payout), the rolling number animation starts from the previous value. If polling occurs again before the animation completes, a second animation kicks off from wherever the first was mid-roll, causing a visible jump.
**Fix:** Use `useRef` to track the *animation target* (not current display value). On new value, cancel any in-progress animation and start fresh from the current displayed value.

---

### [P4] Dashboard does not auto-poll
**File:** `client/src/pages/DashboardPage.jsx`
**Issue:** The dashboard loads games/invites once on mount but has no polling loop. If another player accepts an invite or the host starts a game, the dashboard stays stale until a manual refresh.
**Fix:** Add a `setInterval(loadData, 30_000)` — same pattern as LobbyPage. This ensures invites and game status updates appear without asking players to refresh.

---

## SECTION 4 — UX GAPS

### [P2] Illegal tile clicks have zero feedback
**File:** `client/src/pages/GamePage.jsx` — `handleTileClick()`
**Issue:** When a player clicks a greyed-out (illegal) tile during their turn, `handleTileClick` returns silently. The player may think the app froze or the click didn't register, leading to frustrated repeated tapping on mobile.
**Fix:** On illegal tile click during `isMyTurn && isPlacePhase`, show a brief shake animation on the tile and optionally a toast: "Can't play that tile — it would merge two safe chains." (See razzle-dazzle section for the shake animation.)

---

### [P2] No visual indicator that it's your turn when tab is in background
**File:** `client/src/pages/GamePage.jsx`
**Issue:** If it becomes a player's turn while their browser tab is not focused, they have no way to know (no push notification, no tab badge, no sound). They rely on manually switching back to the tab and seeing the banner.
**Fix:** Use the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) + `document.title` update: when it becomes your turn and the tab is hidden, change the page title to "⚡ Your turn! — Mergers". Revert when the tab is focused again. No server changes needed.

---

### [P2] Survivor chain not visually distinct during merger decisions
**File:** `client/src/components/Game/Dialogs/MergerDecisionDialog.jsx`
**Issue:** During `MERGER_DECISIONS`, the dialog tells players which chain is defunct and what to do with their shares. But the *survivor* chain (where traded shares go) doesn't have a clear visual call-out. New players may not realize they're trading INTO the surviving chain.
**Fix:** Add a green pill/badge: "→ surviving as **Continental**" with the chain's color swatch next to it.

---

### [P3] Stock bank low-supply not warned
**File:** `client/src/components/Game/StockPanel.jsx`
**Issue:** If only 1–2 shares of a chain remain in the bank, there's no visual warning. A player buying the last shares, then another player needing to trade into that chain during a merger, will see a confusing "not enough shares in bank" error.
**Fix:** When `stockBank[chain] <= 2`, show the bank count in amber/orange. When it's 0, show "Sold out" in red.

---

### [P3] Merger decision slider doesn't show cost/proceeds preview
**File:** `client/src/components/Game/Dialogs/MergerDecisionDialog.jsx`
**Issue:** Players adjusting sell/trade sliders don't see the dollar amount they'll receive until they confirm. For sell decisions, this requires mental math (shares × stock price). New players won't know the price offhand.
**Fix:** Below the sliders, add a live preview: "Selling 3 shares → +$600" and "Trading 4 shares → 2 [Survivor] shares."

---

### [P3] No indication of what "retire" means for stock/cash
**File:** `client/src/pages/GamePage.jsx` — retire confirmation card
**Issue:** The retirement confirmation says "Retire permanently? Your tiles are discarded." but doesn't mention that the player *keeps* their stocks and cash and still participates in merger payouts. Players may be afraid to retire thinking they lose everything.
**Fix:** Update copy: "Retire permanently? Your tiles are discarded but you **keep all stocks and cash**, and still receive merger bonuses."

---

### [P3] Chain founding dialog has no explanation of chain tiers
**File:** `client/src/components/Game/Dialogs/NameChainDialog.jsx`
**Issue:** The chain selection screen shows the 7 chain names but gives no hint about which are cheap/mid/expensive. A new player choosing between Tower and Continental doesn't know Continental is worth 4x more per share at the same size.
**Fix:** Add a subtle price-tier label under each chain name: "Budget", "Mid", or "Premium". Or show the starting price per share.

---

### [P4] No "waiting for other players" idle animation
**File:** `client/src/pages/GamePage.jsx` — footer / TurnBanner
**Issue:** When it's not your turn, the UI is completely static. Players waiting have no sense that the game is "alive" — they could wonder if the app is frozen.
**Fix:** Add a subtle pulsing animation to the "Waiting for Alice…" text — e.g., a slow opacity oscillation or a scrolling dots indicator (`…`). Framer Motion `animate={{ opacity: [1, 0.4, 1] }}` with `repeat: Infinity` on the waiting message.

---

### [P4] No end-game score summary breakdown
**File:** `client/src/pages/GamePage.jsx` — game-over screen
**Issue:** The game-over screen shows final cash but no breakdown of how each player got there (bonus payouts, stock sale proceeds per chain). Players want to understand why they won or lost.
**Fix:** The `publicState.log` already contains the payout entries. On the game-over screen, filter the log for entries containing "earns" or "bonus" and display them in a "How it ended" summary panel.

---

## SECTION 5 — RAZZLE-DAZZLE (Sound & Animation)

> These are the biggest opportunities to make the game feel alive. All sound suggestions use the Web Audio API or short preloaded `<audio>` clips (< 50KB). All animation suggestions use Framer Motion, which is already installed.

---

### [P2] 🔊 "Your turn" audio cue
**Where:** `client/src/pages/GamePage.jsx` — detect transition to `isMyTurn === true`
**What:** A short (~300ms) ascending two-note chime. Vegas bell or casino chip sound.
**Why this is P2:** Players frequently have this tab in the background. An audio cue is the most reliable way to bring them back. This dramatically reduces "I didn't know it was my turn" friction.
**Implementation:** Use a `useEffect` watching `isMyTurn`. When it transitions from `false → true`, play the sound. Guard against playing on initial page load with a `hasLoadedRef`.

---

### [P2] 🎬 Tile placement spring animation (already partially done — needs polish)
**Where:** `client/src/components/Game/Board/BoardCell.jsx` + `GamePage.jsx`
**Current state:** `justPlacedTiles` detection exists; Framer Motion `scale: [1.45, 1]` spring is applied.
**What's missing:** The animation only fires for YOUR placed tiles. When an opponent places a tile (detected via board diff on next poll), there's no animation — the tile just appears.
**Fix:** Extend `justPlacedTiles` detection to fire for ALL board changes, not just tiles placed by the current player. The `prevBoardRef` diff already exists; just remove the "is it my tile?" filter.

---

### [P3] 🎬 Chain founding glow burst
**Where:** `client/src/components/Game/Dialogs/NameChainDialog.jsx` + board
**What:** When a chain is named and founded, all tiles belonging to the new chain should briefly pulse with an outward glow ring. Duration ~800ms. Color matches the chain's neon color.
**Why:** Chain founding is the biggest "I did something!" moment in the early game. Currently silent.
**Implementation:** After `NAME_CHAIN` → confirmed, emit a `chainFounded` event client-side. The board cells that match the new chain's tiles animate with `boxShadow: [chainColor, 'transparent']` via Framer Motion.

---

### [P3] 🎬 Merger absorption sweep animation
**Where:** `client/src/pages/GamePage.jsx` — board
**What:** When a merger resolves and defunct chain tiles change color to the survivor, animate them sequentially (stagger by 60ms) rather than all snapping at once. Each tile transitions through a brief white flash before settling on the new color.
**Why:** Mergers are the most dramatic event in the game. A color sweep makes them feel visceral and satisfying.
**Implementation:** The board diff between polls reveals exactly which tiles changed. Apply Framer Motion staggered `animate={{ backgroundColor: ['#fff', survivorColor] }}` with stagger delay.

---

### [P3] 🔊 Merger payout "cha-ching"
**Where:** `client/src/pages/GamePage.jsx` — detect when you receive a merger bonus
**What:** When a player receives a majority or minority bonus, play a coin/cash register sound (~400ms). Louder/more elaborate for majority, subtle for minority.
**Why:** Bonus payouts are the emotional peak of Acquire. Reinforcing them with sound creates a Pavlovian satisfaction loop.
**Implementation:** Parse the log entries on each poll diff. If a new entry contains your player name and "earns" (the payout log format), trigger the sound.

---

### [P3] 🎬 Stock price flash when chain grows
**Where:** `client/src/components/Game/` — chain table, price column
**What:** When a chain's size crosses a price tier (e.g., grows from 5 → 6 tiles, bumping price from $600 to $700), the price cell flashes gold/yellow briefly.
**Why:** Makes the price-per-size mechanic tangible. Players immediately see when their investment appreciates.
**Implementation:** Track previous `chain.size` in a ref. If size crosses a tier boundary (use the existing price chart), trigger `animate={{ color: ['#fbbf24', '#d1d5db'] }}` on the price cell.

---

### [P3] 🔊 Tile draw sound
**Where:** `client/src/pages/GamePage.jsx` — detect `myTiles.length` increasing
**What:** A subtle "card flip" or "tile click" sound (~150ms) when a new tile appears in your hand.
**Why:** Draws attention to your new tile without being intrusive. Also gives satisfying tactile feedback.
**Implementation:** `useEffect` watching `myTiles.length`. If it increases, play sound.

---

### [P3] 📄 Document title badge for active turn
**Where:** `client/src/pages/GamePage.jsx`
**What:** `document.title = "⚡ Your Turn! — Mergers"` when `isMyTurn` becomes true and the tab is not focused. Reset to `"Mergers"` when focused.
**Why:** Zero-effort implementation, maximum impact for players with multiple tabs open. This is P2 quality payoff at P4 implementation cost.
**Implementation:** 5 lines of code using `document.visibilityState` and `document.title`.

---

### [P4] 🎬 Shake animation for illegal tile clicks
**Where:** `client/src/pages/GamePage.jsx` — `handleTileClick()` illegal tile path
**What:** A brief horizontal shake (3 oscillations, 300ms total) on the tile button when clicked illegally.
**Why:** Confirms the click was registered while clearly communicating "no."
**Implementation:** Add a `shakingTile` state. On illegal click, set `shakingTile = tileId`, clear after 300ms. Apply `animate={{ x: [0, -4, 4, -4, 0] }}` to the tile's Framer Motion wrapper.

---

### [P4] 🎬 Waiting pulse on opponent's turn
**Where:** `client/src/pages/GamePage.jsx` — footer waiting state
**What:** When it's not your turn, the footer shows a slow-breathing pulse on the "Waiting for X…" message — opacity cycling 100% → 50% → 100% over 2 seconds, looping.
**Why:** Makes the game feel alive even when you're waiting. Subtle enough not to be annoying.
**Implementation:** `<motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 2 }}>Waiting for {activePlayer.name}…</motion.span>`

---

### [P4] 🎬 Player net worth trend arrows
**Where:** `client/src/pages/GamePage.jsx` — player standings sidebar
**What:** After each poll, compare current net worth to previous. If increased, show a tiny `↑` in green next to the player's total for 3 seconds. If decreased, `↓` in red.
**Why:** Creates drama in the standings. Players track their relative position obsessively.
**Implementation:** Store previous net worths in a `useRef`. On publicState change, diff and set a `trendMap` state with a setTimeout to clear.

---

### [P4] 🔊 Ambient casino background audio (optional, opt-in)
**Where:** App-level setting
**What:** Very quiet casino ambience loop (slot machines, light chatter) that plays in the background. Must be opt-in (a mute toggle in the game header).
**Why:** Sells the Vegas atmosphere. Even at 5% volume it changes the feel completely.
**Implementation:** An `<audio loop>` element. Add a 🔊/🔇 toggle button to the game header. Persist preference to localStorage.

---

## SECTION 6 — LEGACY / DEAD CODE

### [P3] Socket.io game handlers appear unused
**File:** `server/socketHandlers/gameHandlers.js`, `server/socketHandlers/lobbyHandlers.js`
**Issue:** The current architecture uses REST API + polling exclusively (as of the "Async MVP" commit). The socket handler files appear to be legacy from an earlier prototype. They reference an old in-memory state model incompatible with the current Supabase-backed state.
**Fix:** If sockets are not planned for re-introduction, delete these files to reduce confusion. If WebSocket support is planned for Phase 7, leave them but add a comment: `// NOT IN USE — REST API is used instead. See routes/games.js.`

---

### [P3] WaitingRoom.jsx and HomePage.jsx (Lobby components) may be unused
**Files:** `client/src/components/Lobby/WaitingRoom.jsx`, `client/src/components/Lobby/HomePage.jsx`
**Issue:** The active lobby UI is `client/src/pages/LobbyPage.jsx`. These component-folder files may be leftover from an earlier architecture pass.
**Fix:** Verify by searching for imports of these components. If unused, delete them.

---

### [P4] store.js (Zustand) may be unused
**File:** `client/src/store.js`
**Issue:** The tech stack originally included Zustand for state management. The current architecture uses local `useState` in each page. Zustand may not be imported anywhere.
**Fix:** Check if `store.js` is imported anywhere. If not, remove it and the `zustand` package from `package.json`.

---

## SECTION 7 — QUICK WINS (High Impact, Low Effort)

These are things that can be done in under 30 minutes each and have outsized impact:

| # | What | File | Effort | Impact |
|---|------|------|--------|--------|
| 1 | Document title badge (`⚡ Your Turn!`) | GamePage.jsx | 5 min | High |
| 2 | Lobby poll interval 10s → 30s | LobbyPage.jsx | 1 min | Medium |
| 3 | Memoize tile classifications | GamePage.jsx | 5 min | Medium |
| 4 | Fix retire copy (mention keeping stocks/cash) | GamePage.jsx | 2 min | Medium |
| 5 | Dashboard auto-poll (30s) | DashboardPage.jsx | 5 min | Medium |
| 6 | Waiting pulse animation | GamePage.jsx | 10 min | High feel |
| 7 | Stock bank low-supply warning | StockPanel.jsx | 15 min | Medium |
| 8 | Server-side game name length enforcement | routes/games.js | 5 min | Low but correct |

---

## SECTION 8 — ARCHITECTURAL NOTES

**These are not action items but worth knowing:**

1. **No server-side persistence of in-progress game state between deploys.** `game_states` is stored in Supabase, so it survives restarts — this is good. However, if a schema change requires a migration, in-progress games may break. Always test migrations against a game in `ACTIVE` status.

2. **Polling lag is inherent to the current architecture.** The game polls every 3–4 seconds. This means worst-case 4-second delay between one player's action and another seeing it. For most turns this is fine. For mergers (where 4 players each need to make a decision serially), total lag can stack to 16+ seconds of dead time. This is acceptable for an async game but worth communicating to players ("This game is turn-based — moves appear within a few seconds").

3. **The Socket.io infrastructure is still wired up in server/index.js** but not used by any active frontend code. A future Phase 7 could replace polling with WebSocket push for a real-time feel — this would dramatically reduce both latency and server load.

4. **`resetGameState` discards full game history.** The Play Again feature resets the board completely. If you ever want to add a "game history" or "replay" feature, the state history would need to be preserved separately.

---

*End of analysis. Recommended starting point: tackle Section 7 Quick Wins first, then work through P1/P2 bugs, then add the P2/P3 razzle-dazzle items for the "feels alive" experience.*
