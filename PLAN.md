  ---
  Technical Plan: Mergers (Acquire Online)

  Rules Analysis: What Makes This Complex

  Before the tech, it's worth naming the hard parts, because they drive the architecture:

  ┌───────────────────────────────────────────┬───────────────────────────────────────────────────┐
  │                   Rule                    │                    Complexity                     │
  ├───────────────────────────────────────────┼───────────────────────────────────────────────────┤
  │ Merger resolution with multiple defunct   │ Players interact out of normal turn order         │
  │ chains                                    │                                                   │
  ├───────────────────────────────────────────┼───────────────────────────────────────────────────┤
  │ 2-player bank tile                        │ Special case that affects bonus math              │
  ├───────────────────────────────────────────┼───────────────────────────────────────────────────┤
  │ Tile legality (safe-chain merges, 8th     │ Must validate every tile on every turn            │
  │ chain)                                    │                                                   │
  ├───────────────────────────────────────────┼───────────────────────────────────────────────────┤
  │ Retirement                                │ Permanently removes tiles from play, changes turn │
  │                                           │  flow                                             │
  ├───────────────────────────────────────────┼───────────────────────────────────────────────────┤
  │ Equal-size merger                         │ Requires a UI prompt mid-turn                     │
  ├───────────────────────────────────────────┼───────────────────────────────────────────────────┤
  │ Founding a chain                          │ Requires a name-selection prompt mid-turn         │
  └───────────────────────────────────────────┴───────────────────────────────────────────────────┘

  All of these are server-side decisions. The client just shows prompts and sends responses.

  ---
  1. Recommended Tech Stack

  Frontend

  ┌─────────────────┬────────────────┬────────────────────────────────────────────────────────────┐
  │   Technology    │      Role      │                            Why                             │
  ├─────────────────┼────────────────┼────────────────────────────────────────────────────────────┤
  │ React           │ UI framework   │ Component-based, easy to reason about, massive ecosystem   │
  ├─────────────────┼────────────────┼────────────────────────────────────────────────────────────┤
  │ Vite            │ Build tool     │ Fast dev server, simple config — no webpack complexity     │
  ├─────────────────┼────────────────┼────────────────────────────────────────────────────────────┤
  │ Tailwind CSS    │ Styling        │ Utility-first, excellent mobile support, no separate CSS   │
  │                 │                │ files                                                      │
  ├─────────────────┼────────────────┼────────────────────────────────────────────────────────────┤
  │ Socket.io       │ Real-time      │ Handles WebSocket + reconnection automatically             │
  │ client          │ comms          │                                                            │
  ├─────────────────┼────────────────┼────────────────────────────────────────────────────────────┤
  │ Zustand         │ Client state   │ Tiny, simple — one file, easy to read vs. Redux            │
  └─────────────────┴────────────────┴────────────────────────────────────────────────────────────┘

  Backend

  ┌─────────────────┬───────────────┬────────────────────────────────────────────────────────────┐
  │   Technology    │     Role      │                            Why                             │
  ├─────────────────┼───────────────┼────────────────────────────────────────────────────────────┤
  │ Node.js +       │ HTTP server   │ JavaScript everywhere, one language to learn               │
  │ Express         │               │                                                            │
  ├─────────────────┼───────────────┼────────────────────────────────────────────────────────────┤
  │ Socket.io       │ WebSocket     │ Industry standard for turn-based games, pairs perfectly    │
  │                 │ layer         │ with frontend                                              │
  ├─────────────────┼───────────────┼────────────────────────────────────────────────────────────┤
  │ In-memory store │ Game state    │ No database needed — state lives in server RAM during a    │
  │                 │               │ session                                                    │
  ├─────────────────┼───────────────┼────────────────────────────────────────────────────────────┤
  │ nanoid          │ Room codes    │ Generates short readable codes like K7XM2P                 │
  └─────────────────┴───────────────┴────────────────────────────────────────────────────────────┘

  No database, no accounts

  All game state is held in server memory. When all players disconnect, the room is cleaned up after a
   timeout. This avoids all auth and ops complexity.

  Deployment

  A single server on Railway or Render (free/cheap tier) serves both the API and the built frontend
  files. One URL, no separate hosting.

  ---
  2. Game State Management & Sync

  The Golden Rule: Server is the single source of truth

  The client never modifies game state. It only:
  1. Sends player actions to the server (PLACE_TILE, NAME_CHAIN, CHOOSE_MERGER_ACTION, BUY_STOCKS,
  RETIRE, DECLARE_END, etc.)
  2. Receives state broadcasts and re-renders

  Player clicks a tile
          │
          ▼
  Client sends event ──► Server validates the action
                                │
                         Valid? │ Invalid?
                                ▼        ▼
                         Apply to state  Send error back
                         Update phase    to that player only
                                │
                                ▼
                      Broadcast full state to ALL players
                      + private tile hand to individual player

  Turn phases (server tracks which phase we're in)

  The server uses an explicit turnPhase field to control what actions are legal at any moment. This is
   critical because turns are not linear — mergers pause normal flow and collect input from multiple
  players.

  DECLARE_START       → player may declare game over
         ↓
  PLACE_TILE          → waiting for active player to place a tile
         ↓ (if tile founds a chain)
  NAME_CHAIN          → waiting for active player to pick a chain name
         ↓ (if tile merges chains)
  MERGER_BONUS        → server calculates and pays bonuses automatically
         ↓
  MERGER_DECISIONS    → collecting sell/trade/keep from each affected player in order
         ↓
  BUY_STOCKS          → waiting for active player to buy (0–3 stocks) or skip
         ↓
  DECLARE_END         → player may declare game over
         ↓
  DRAW_TILE           → server draws tile, replaces unplayable tiles, advances turn

  What the full state object contains

  GameState {
    roomCode:        string,
    phase:           "lobby" | "playing" | "game_over",
    turnPhase:       "PLACE_TILE" | "NAME_CHAIN" | "MERGER_DECISIONS" | "BUY_STOCKS" | ...,
    activePlayerIndex: number,
    mergerContext: {            // populated during mergers
      survivorChain,
      defunctChains: [],        // if tile touches 3 chains, queue of mergers to resolve
      pendingPlayers: [],       // player order for stock decisions
      currentDecisionPlayer,
    },

    board: {                    // 108 cells keyed by "A1"..."L9"
      "A1": { state: "empty" | "lone" | chainName }
    },

    players: [
      {
        id, name, isRetired, isActive,
        cash,
        stocks: { tower:0, luxor:0, american:0, worldwide:0, festival:0, imperial:0, continental:0 },
        // tiles are PRIVATE — sent separately to each player
      }
    ],

    chains: {
      tower:       { size: 0, isActive: false, isSafe: false },
      luxor:       { ... },
      american:    { ... },
      worldwide:   { ... },
      festival:    { ... },
      imperial:    { ... },
      continental: { ... },
    },

    stockBank: { tower:25, luxor:25, ... },  // shares remaining to buy

    retiredTilePositions: Set<string>,  // positions blocked by retired players
    drawPile: string[],                 // remaining tile IDs (shuffled)
    log: string[],                      // human-readable action history
    winner: null | playerId,
  }

  Sync strategy

  - On any state change, server sends the full public state to all players in the room
  - Server also sends a private message to each individual player containing only their own tile hand
  - Full-state broadcast is fine at this scale — the payload is ~8KB, negligible for a board game
  - No differential patching needed; React re-renders efficiently from the new state

  Private information

  ┌────────────────────┬──────────────────────────────────────────────────────┐
  │        Data        │                     Who sees it                      │
  ├────────────────────┼──────────────────────────────────────────────────────┤
  │ Tile hand          │ Only the owner (sent as a private Socket.io message) │
  ├────────────────────┼──────────────────────────────────────────────────────┤
  │ Cash on hand       │ Public (shown for all players)                       │
  ├────────────────────┼──────────────────────────────────────────────────────┤
  │ Stock holdings     │ Public (hover for detail, per the rules)             │
  ├────────────────────┼──────────────────────────────────────────────────────┤
  │ Draw pile contents │ Nobody                                               │
  └────────────────────┴──────────────────────────────────────────────────────┘

  ---
  3. Room / Lobby System

  Full flow

  Player A (host)                  Server                        Players B–F
     │                               │                               │
     ├── Enter name, click CREATE ──►│                               │
     │◄── roomCode: "K7XM2P" ────────┤                               │
     │    URL: /room/K7XM2P          │                               │
     │    (share this with friends)  │                               │
     │                               │    Enter name, paste code ───►│
     │                               ├── Broadcast lobby update ────►│
     │◄── Broadcast lobby update ────┤                               │
     │    (see B in waiting room)    │                               │
     │                               │          (repeat for C–F)     │
     │                               │                               │
     ├── Click START (host only) ───►│ Validates 2–6 players         │
     │                               ├── Deal tiles, init state ─────┤
     │◄── Game state broadcast ──────┼──────────────────────────────►│

  Room lifecycle

  1. Lobby — Players join by visiting /room/K7XM2P or entering the code. They type a display name (no
  account). The host sees a "Start Game" button once 2+ players have joined (and up to 6).
  2. In-Game — Room is locked. Late arrivals see "Game in progress."
  3. Game Over — Scores displayed with full breakdown. Host can "Play Again" (reshuffles, redeals,
  resets state — same room code, same players).
  4. Abandoned — Server deletes the room after 2 hours of inactivity.

  Reconnection handling

  - On join, each player's browser receives and stores a playerId UUID in sessionStorage
  - If a player disconnects and rejoins the same room within 10 minutes with the same playerId, they
  are silently re-slotted and the game continues
  - Other players see (reconnecting...) next to that name
  - If they don't return, the host can kick them and continue (if 2+ remain) or the game is abandoned

  ---
  4. Build Order (Phases)

  Phase 1 — Foundation: Server + Room System

  What we build:
  - Node/Express server with Socket.io
  - Room creation (generates code) and joining
  - Lobby waiting room with player list
  - Host controls: start game, kick player
  - Shareable room URL (/room/CODE)
  - Reconnection with sessionStorage player ID

  Deliverable: Open multiple browser tabs, join a room, see each other's names, host can start.

  ---
  Phase 2 — Board & Tile Mechanics

  What we build:
  - 12×9 board rendered as a grid in React, cells labeled A1–L9
  - Tile draw, shuffle, initial deal (6 tiles per player)
  - Display each player's private tile hand (only their own)
  - Tile placement: click to play, server validates legality
  - Tile legality highlighting: playable = white, unplayable = greyed (would merge 2 safe chains, or
  would found 8th chain)
  - Turn advancement, whose-turn indicator
  - Draw new tile at end of turn; replace unplayable tiles automatically

  Deliverable: Players take turns placing tiles on a shared board. Board updates live for everyone.

  ---
  Phase 3 — Chain Founding & Stock Market

  What we build:
  - Chain founding detection (tile adjacent to lone tile, not in a chain)
  - "Name this chain" dialog for the founding player
  - Award 1 free founding stock (if available)
  - Chain display with 7 color-coded chains and their sizes
  - Price chart lookup (size → price per tier)
  - Stock market panel: available shares, your shares, current price, bold if you hold majority
  - Buy stocks UI (up to 3 per turn, cash validation, bank stock depletion)
  - Safe chain detection and visual indicator (size shown in red at 11+)
  - Net worth display for all players (cash + stock value)

  Deliverable: Chains appear and grow, players buy stock, prices update correctly.

  ---
  Phase 4 — Mergers

  What we build:
  - Merger detection on tile placement (tile adjacent to 2+ chains)
  - Survivor determination: largest chain wins; equal-size → merging player picks
  - Multi-chain merger queue (tile touching 3 chains → resolve one at a time)
  - Shareholder bonus calculation and payout:
    - Majority (1st): 10× defunct chain's stock price
    - Minority (2nd): 5× defunct chain's stock price
    - Tie splitting (rounded up to nearest $100)
    - Single-shareholder gets both bonuses
    - 2-player special rule: bank draws a random tile to compete
  - Per-player merger decision UI: sell / trade 2:1 / keep (can mix)
  - Trade validation (survivor stock availability)
  - Post-merger flow: return to active player → buy stocks phase
  - Defunct chain cleanup (reset to inactive, size 0)

  Deliverable: Full merger flow works correctly including bonuses, stock decisions, and multi-chain
  mergers.

  ---
  Phase 5 — End Game & Retirement

  What we build:
  - Retirement action: player announces on their turn; tiles permanently removed from play
  - End-game declaration: available at start or end of turn when condition is met
  - End-game conditions checked after every tile placement:
    - Any chain ≥ 41 tiles
    - All active chains safe (≥ 11 tiles, at least 1 exists)
    - All players retired
  - Final payout: bonuses for all active chains, then sell all stock at market price
  - Winner screen: full score breakdown (cash + stock sold + bonuses received, running total)
  - "Play Again" resets the room to a new game

  Deliverable: Complete game from start to finish including all end conditions.

  ---
  Phase 6 — Polish & Mobile

  What we build:
  - Mobile layout: scrollable/zoomable board, bottom-sheet panels for hand/stocks
  - Game log panel (scrollable history of every action)
  - Animations: tile placement, stock purchase, bonus payout flash
  - Clear error messages for invalid moves
  - Loading and reconnecting states
  - Keyboard shortcuts for desktop (optional)
  - Final visual pass: color scheme, typography, accessibility

  Deliverable: Production-ready, polished, mobile-friendly game.

  ---
  5. Folder Structure

  acquire-online/
  ├── package.json               # Root — defines "client" and "server" workspaces
  │
  ├── shared/                    # Code imported by both client and server
  │   └── constants.js           # Chain names, board dimensions, price chart, bonus chart
  │
  ├── server/
  │   ├── index.js               # Express app + Socket.io setup, serves /client/dist in prod
  │   │
  │   ├── rooms/
  │   │   └── roomManager.js     # In-memory Map of rooms; create, find, delete, timeout logic
  │   │
  │   ├── game/
  │   │   ├── GameState.js       # State shape definition and initial state factory
  │   │   ├── gameEngine.js      # Orchestrates turn flow; calls the logic modules below
  │   │   ├── boardLogic.js      # Adjacency checks, tile legality, chain connectivity
  │   │   ├── chainLogic.js      # Founding, growing, safe detection, connectivity flood-fill
  │   │   ├── mergerLogic.js     # Merger detection, survivor selection, bonus math, stock decisions
  │   │   ├── stockLogic.js      # Price chart lookup, buy validation, net worth calculation
  │   │   └── tileLogic.js       # Draw pile, dealing, hand management, tile replacement
  │   │
  │   └── socketHandlers/
  │       ├── lobbyHandlers.js   # createRoom, joinRoom, startGame, kickPlayer, reconnect
  │       └── gameHandlers.js    # placeTile, nameChain, mergerDecision, buyStocks, retire, declareEnd
  │
  └── client/
      ├── index.html
      ├── vite.config.js
      ├── tailwind.config.js
      └── src/
          ├── main.jsx           # Entry point
          ├── App.jsx            # Routes between Lobby and Game based on room phase
          ├── socket.js          # Socket.io singleton (one connection for the whole app)
          ├── store.js           # Zustand store: holds gameState + myTiles + myPlayerId
          │
          ├── components/
          │   ├── Lobby/
          │   │   ├── HomePage.jsx        # Create or join a room
          │   │   ├── CreateRoom.jsx      # Name entry + create button
          │   │   ├── JoinRoom.jsx        # Name entry + code entry
          │   │   └── WaitingRoom.jsx     # Player list, share link, start button (host only)
          │   │
          │   ├── Game/
          │   │   ├── GameLayout.jsx      # Overall game screen layout
          │   │   ├── Board/
          │   │   │   ├── GameBoard.jsx   # 12×9 grid
          │   │   │   └── BoardCell.jsx   # Single cell: empty/lone/chain color, click handler
          │   │   ├── PlayerHand.jsx      # Your 6 tiles (private); highlights playable ones
          │   │   ├── ChainTable.jsx      # All 7 chains: size, price, your shares, bank shares, bold
  majority
          │   │   ├── PlayerList.jsx      # All players: name, net worth, retired indicator
          │   │   ├── TurnBanner.jsx      # "Your turn" / "Waiting for [name]..." + current phase
          │   │   ├── ActionPanel.jsx     # Context-sensitive: buy stocks form, or end-turn button
          │   │   ├── GameLog.jsx         # Scrollable history of events
          │   │   └── Dialogs/
          │   │       ├── NameChainDialog.jsx     # Pick which chain to found
          │   │       ├── SurvivorDialog.jsx      # Pick survivor in equal-size merger
          │   │       └── MergerDecisionDialog.jsx # Sell / trade / keep for each player
          │   │
          │   └── EndGame/
          │       └── ScoreScreen.jsx    # Final scores with full breakdown, play again button
          │
          └── utils/
              └── formatting.js          # Format dollars, tile IDs, chain display names

  ---
  Key Design Decisions

  ┌──────────────────┬──────────────────────────┬─────────────────────────────────────────────────┐
  │     Decision     │          Choice          │                    Rationale                    │
  ├──────────────────┼──────────────────────────┼─────────────────────────────────────────────────┤
  │ Monorepo         │ Single repo, two folders │ Share constants easily, one deploy              │
  ├──────────────────┼──────────────────────────┼─────────────────────────────────────────────────┤
  │ Database         │ None (in-memory)         │ No persistence needed; avoids all ops/config    │
  │                  │                          │ complexity                                      │
  ├──────────────────┼──────────────────────────┼─────────────────────────────────────────────────┤
  │ Auth             │ None (sessionStorage     │ Zero friction; meets requirements exactly       │
  │                  │ UUID)                    │                                                 │
  ├──────────────────┼──────────────────────────┼─────────────────────────────────────────────────┤
  │ State sync       │ Full broadcast every     │ Simple, correct, ~8KB payload is fine for a     │
  │                  │ change                   │ board game                                      │
  ├──────────────────┼──────────────────────────┼─────────────────────────────────────────────────┤
  │ Game logic       │ Server only              │ Prevents cheating; client is a "dumb" display   │
  ├──────────────────┼──────────────────────────┼─────────────────────────────────────────────────┤
  │ Turn phase       │ Explicit turnPhase enum  │ Mergers break the simple turn model; phases     │
  │ tracking         │                          │ make it auditable                               │
  ├──────────────────┼──────────────────────────┼─────────────────────────────────────────────────┤
  │ Multi-chain      │ Queue resolved one at a  │ Matches official rules; keeps each merger       │
  │ mergers          │ time                     │ decision UI simple                              │
  └──────────────────┴──────────────────────────┴─────────────────────────────────────────────────┘

  ---