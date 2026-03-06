# Hotel Shenanigans — Async Architecture: Technical Development Plan

**Version:** 1.0
**Date:** 2026-03-06
**Author:** Tech Lead (AI)
**Status:** Awaiting Approval

---

## Table of Contents

1. [Architectural Overview](#1-architectural-overview)
2. [Technology Decisions](#2-technology-decisions)
3. [Database Schema](#3-database-schema)
4. [API Endpoint Reference](#4-api-endpoint-reference)
5. [The Merger Bottleneck — Architectural Solution](#5-the-merger-bottleneck--architectural-solution)
6. [Phase 1 — Infrastructure & Auth](#6-phase-1--infrastructure--auth)
7. [Phase 2 — Schema, Lobby & Invitations](#7-phase-2--schema-lobby--invitations)
8. [Phase 3 — Core Async Turn Logic](#8-phase-3--core-async-turn-logic)
9. [Phase 4 — Merger Sequence Logic](#9-phase-4--merger-sequence-logic)
10. [Phase 5 — Frontend Migration](#10-phase-5--frontend-migration)
11. [Phase 6 — Deployment & Cutover](#11-phase-6--deployment--cutover)
12. [What We Are Keeping From the MVP](#12-what-we-are-keeping-from-the-mvp)

---

## 1. Architectural Overview

### What We Are Moving Away From
The MVP runs every interaction through a persistent WebSocket connection (Socket.io). When a player places a tile, the server immediately broadcasts the new state to all connected sockets. This means:
- All players must be online simultaneously.
- A dropped connection interrupts the game.
- The state lives only in server memory — a server restart destroys everything.

### What We Are Moving To
A **REST API + Persistent Database** model where:
- Players visit the app at their convenience, submit their action, and leave.
- The server persists all game state to a database after every action.
- Players poll (or visit) the app to see updates; there is no live connection requirement.
- The server is the single source of truth (same rule as the MVP), but now that truth survives restarts.

```
[Player Browser] --HTTP POST--> [Express REST API] --read/write--> [Supabase / PostgreSQL]
[Player Browser] --HTTP GET---> [Express REST API] --read-------> [Supabase / PostgreSQL]
```

No WebSockets. No Socket.io. No persistent connections.

---

## 2. Technology Decisions

### 2.1 Database: Supabase (PostgreSQL)

**Recommendation: Supabase**

Supabase is a hosted PostgreSQL service with a built-in JavaScript client, a managed Auth module (which handles Google OAuth out of the box), and Row-Level Security policies. It is the right fit because:

| Need | Why Supabase |
|---|---|
| Persistent game state across sessions | PostgreSQL — relational, durable, ACID |
| Complex JSON game state (board, chains, stocks) | PostgreSQL `JSONB` column — queryable JSON |
| Google OAuth | Supabase Auth handles the full OAuth flow and session management |
| Invitation emails | Supabase has a built-in email hook, but we will use Resend for transactional email |
| Cost | Generous free tier, no credit card required to start |
| Single JS client for both REST and auth | `@supabase/supabase-js` does both |

**Why not alternatives:**
- **Firebase Firestore:** Excellent for simple document stores, but weak for relational queries (e.g., "all games where I have a pending invite"). PostgreSQL is a better fit.
- **MongoDB/Atlas:** Valid choice, but JSONB in PostgreSQL gives us document flexibility plus relational joins.
- **Bare PostgreSQL on Railway:** We need managed auth. Supabase bundles it for free.

### 2.2 Email Provider: Resend

Resend is the simplest transactional email service to integrate with Node.js. One npm package (`resend`), one API key, and clean React Email templates for HTML emails. We will use it to send:
- Lobby invitation emails
- "It's your turn" notification emails
- "Merger decision needed" notification emails

### 2.3 Session Management

Supabase Auth issues JWTs. After a user logs in via Google OAuth, the `@supabase/supabase-js` client stores the session token in `localStorage`. Every API request from the browser includes this JWT in the `Authorization: Bearer <token>` header. The server validates it using the Supabase Admin client.

### 2.4 Polling Strategy (No WebSockets)

The client will poll the game state endpoint (`GET /api/games/:gameId/state`) on a short interval (e.g., every 10 seconds) when the player has the game page open. This is intentionally simple and correct for an async game. A more sophisticated approach (Supabase Realtime subscriptions) can be layered in later if desired.

---

## 3. Database Schema

All tables live in Supabase's PostgreSQL instance. Supabase Auth manages the `auth.users` table automatically; we extend it with a public `users` table via a trigger.

### 3.1 Entity-Relationship Overview

```
auth.users (Supabase managed)
    |
    | 1:1
    v
users (our public profile)
    |
    | 1:N (host)
    v
games --------< game_players (N:M join)
    |                  |
    | 1:1              | -> users (player)
    v
game_states (JSONB blob)
    |
    | 1:N
    v
merger_decisions (one row per player per defunct chain)

games --------< game_invites
                    |
                    | -> users (invitee, nullable until accepted)
```

### 3.2 Full SQL Schema

```sql
-- ============================================================
-- USERS
-- Public profile table. Mirrors auth.users, extended with display name.
-- Populated automatically via a Supabase Auth trigger on signup.
-- ============================================================
CREATE TABLE public.users (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT        UNIQUE NOT NULL,
  display_name  TEXT        NOT NULL,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- GAMES (the lobby and game lifecycle record)
-- ============================================================
CREATE TABLE public.games (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id       UUID        NOT NULL REFERENCES public.users(id),
  name          TEXT        NOT NULL,           -- e.g. "Friday Night Game"
  status        TEXT        NOT NULL DEFAULT 'LOBBY',
  --  'LOBBY'          → waiting for players to accept/decline invites
  --  'ACTIVE'         → game is in progress; a player's turn is in flight
  --  'MERGER_PAUSE'   → game is waiting for non-active players to submit merger decisions
  --  'COMPLETE'       → game is over
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

-- ============================================================
-- GAME INVITES
-- One row per player invited to a game.
-- The host is NOT in this table — they are in game_players directly.
-- ============================================================
CREATE TABLE public.game_invites (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  invitee_email TEXT        NOT NULL,           -- email address the invite was sent to
  invitee_id    UUID        REFERENCES public.users(id),  -- populated once they log in
  status        TEXT        NOT NULL DEFAULT 'PENDING',
  --  'PENDING'  → no response yet
  --  'ACCEPTED' → accepted; a corresponding game_players row has been created
  --  'DECLINED' → declined; this slot is freed
  invited_at    TIMESTAMPTZ DEFAULT NOW(),
  responded_at  TIMESTAMPTZ,
  UNIQUE(game_id, invitee_email)
);

-- ============================================================
-- GAME PLAYERS
-- The confirmed roster of players in a started (or starting) game.
-- One row per player, including the host (seat_order = 0).
-- ============================================================
CREATE TABLE public.game_players (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES public.users(id),
  seat_order    INTEGER     NOT NULL,           -- 0 = host/first player, 1, 2, 3...
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_id, user_id),
  UNIQUE(game_id, seat_order)
);

-- ============================================================
-- GAME STATES
-- The full persistent game state. One row per game.
-- The three JSONB columns map directly to the MVP's in-memory objects,
-- so the existing game logic modules (GameState.js, mergerLogic.js, etc.)
-- can be reused with minimal changes.
-- ============================================================
CREATE TABLE public.game_states (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID        UNIQUE NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,

  -- Public state: board, chains, player cash/stocks, turn tracking, merger context.
  -- This is what all players can see. Maps to getPublicGameState() output.
  public_state  JSONB       NOT NULL,

  -- Private tile hands: { "userId": ["A1", "C3", ...], ... }
  -- Only the owning player may see their own slice.
  player_tiles  JSONB       NOT NULL,

  -- The server-only draw pile: ["B4", "G7", ...]
  -- Never sent to any client.
  draw_pile     JSONB       NOT NULL,

  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MERGER DECISIONS
-- The key table for the async merger bottleneck.
-- When a merger is triggered, one row is inserted per player
-- who holds defunct stock, in their required decision order.
-- Rows accumulate sell/trade/keep values as players submit.
-- The active player's turn is unblocked once all rows are filled.
-- ============================================================
CREATE TABLE public.merger_decisions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  game_id           UUID        NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,

  -- Which "wave" of the merger this is (0-indexed).
  -- A tile that touches 3 chains produces two waves: wave 0 is the
  -- first defunct resolved, wave 1 is the second defunct resolved.
  defunct_wave      INTEGER     NOT NULL DEFAULT 0,

  -- The name of the defunct chain this row resolves (e.g. 'tower')
  defunct_chain     TEXT        NOT NULL,

  -- The player who must decide
  player_id         UUID        NOT NULL REFERENCES public.users(id),

  -- Their seat_order, used to enforce sequential decision-making
  decision_order    INTEGER     NOT NULL,

  -- The decision itself (NULL until submitted)
  sell              INTEGER,
  trade             INTEGER,
  -- "keep" is implicit: (shares_owned - sell - trade)

  submitted_at      TIMESTAMPTZ,           -- NULL = not yet submitted

  UNIQUE(game_id, defunct_wave, defunct_chain, player_id)
);

-- ============================================================
-- EMAIL NOTIFICATIONS LOG
-- Tracks which emails have been sent to avoid duplicates.
-- ============================================================
CREATE TABLE public.email_notifications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id           UUID        REFERENCES public.games(id) ON DELETE CASCADE,
  recipient_email   TEXT        NOT NULL,
  notification_type TEXT        NOT NULL,
  --  'GAME_INVITE'             → lobby invitation
  --  'YOUR_TURN'               → it is now your turn
  --  'MERGER_DECISION_NEEDED'  → you need to submit a merger decision
  --  'GAME_OVER'               → game has ended
  sent_at           TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. API Endpoint Reference

All endpoints are prefixed `/api`. All endpoints except the auth endpoints require a valid Supabase JWT in the `Authorization: Bearer <token>` header. The server validates it server-side using the Supabase Admin client.

### 4.1 Auth

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/me` | Returns the currently authenticated user's profile. Used by the client on load to check login status. |
| `GET` | `/api/auth/google` | Initiates Google OAuth flow. Redirects the user to Google's consent screen. Handled by Supabase Auth's redirect URL. |
| `POST` | `/api/auth/logout` | Clears the session. Client clears the JWT from localStorage. |

> Note: The actual OAuth redirect and token exchange is handled entirely by Supabase Auth on the client side using `supabase.auth.signInWithOAuth({ provider: 'google' })`. No custom server routes are needed for the OAuth callback.

### 4.2 Lobby & Invitations

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/games` | `{ name: string }` | Create a new game lobby. Host is automatically added as seat 0. Returns the new `game` record. |
| `GET` | `/api/games` | — | List all games the authenticated user is involved in (as host, invited, or active player). Sorted by recency. |
| `GET` | `/api/games/:gameId` | — | Get full lobby details: game record, invite list with statuses, and confirmed player list. |
| `POST` | `/api/games/:gameId/invite` | `{ email: string }` | Host invites a player by email. Sends an invite email via Resend. Returns the new invite record. |
| `DELETE` | `/api/games/:gameId/invite/:inviteId` | — | Host cancels a pending invite. |
| `POST` | `/api/games/:gameId/start` | — | Host starts the game. **Blocked if any invite is still `PENDING`.** Creates the `game_states` row, shuffles tiles, deals hands, sets `games.status = 'ACTIVE'`, sends "your turn" email to the first player. |

### 4.3 Invite Responses (Invitee Perspective)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/invites` | List all pending invites for the authenticated user. |
| `POST` | `/api/invites/:inviteId/accept` | Accept an invite. Creates a `game_players` row. Updates invite status to `ACCEPTED`. |
| `POST` | `/api/invites/:inviteId/decline` | Decline an invite. Updates invite status to `DECLINED`. |

### 4.4 Game State

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/games/:gameId/state` | Returns the public game state **plus** the requesting player's private tile hand. The draw pile is never sent. This is the primary polling endpoint. |

### 4.5 Turn Submission

This is the core endpoint for the async architecture. The active player builds their entire turn in local browser state, then submits it all at once.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/games/:gameId/turn` | Submit a complete turn. See full spec below. |

**`POST /api/games/:gameId/turn` — Request Body:**

```json
{
  "declareEndGameBefore": false,

  "tilePlaced": "A1",

  "chainFounded": "tower",
  "survivorChoice": "imperial",

  "stocksBought": {
    "luxor": 2,
    "american": 1
  },

  "declareEndGameAfter": false,
  "retirePlayer": false
}
```

**Field rules:**
- `declareEndGameBefore`: Optional. If `true`, server triggers end-game payout immediately and ignores all other fields. Only valid if `endGameAvailable` is `true` in the current state.
- `tilePlaced`: Required (unless declaring end game before). The tile ID the player places.
- `chainFounded`: Required only when the placed tile founds a new chain. The chain name chosen by the player.
- `survivorChoice`: Required only when the placed tile triggers a merger with tied largest chains.
- `stocksBought`: Optional. Object of `{ chainName: quantity }`. Total quantity must not exceed 3.
- `declareEndGameAfter`: Optional. If `true`, server triggers end-game payout after the stock purchase phase.
- `retirePlayer`: Optional. If `true`, player retires at the end of their turn.

**Server-side processing order:**
1. Validate the caller is the active player and game status is `ACTIVE`.
2. Validate the tile is in the player's hand.
3. Apply `declareEndGameBefore` if present.
4. Validate and apply tile placement using existing `boardLogic.js` / `chainLogic.js`.
5. If tile founds a chain, apply `chainFounded` using existing `chainLogic.js`.
6. If tile triggers a merger:
   a. Call existing `initiateMerger()`.
   b. If a tie exists, validate and apply `survivorChoice`.
   c. Set `games.status = 'MERGER_PAUSE'`.
   d. Insert `merger_decisions` rows for each player with defunct stock (see Phase 4).
   e. Send "merger decision needed" emails.
   f. Return `{ status: 'MERGER_PAUSE', ... }` — the active player's buy phase is deferred.
7. Validate and apply `stocksBought` using existing `stockLogic.js`.
8. Draw a replacement tile for the player.
9. Apply `retirePlayer` if present.
10. Apply `declareEndGameAfter` if present.
11. Advance `activePlayerIndex` to the next non-retired player.
12. Persist the full updated state to `game_states`.
13. Send "your turn" email to the next active player.
14. Return `{ status: 'OK', gameState: <public state>, yourTiles: [...] }`.

### 4.6 Merger Decisions (Non-Active Players)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/games/:gameId/merger-decision` | Submit a sell/trade/keep decision for the current merger wave. |

**Request Body:**
```json
{
  "defunctChain": "tower",
  "defunctWave": 0,
  "sell": 3,
  "trade": 2
}
```

Server-side processing is described in full in Section 5 below.

### 4.7 End Game

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/games/:gameId/declare-end-game` | Active player officially declares end game. Triggers payout sequence. Can also be submitted as part of the turn body (see `declareEndGameBefore`/`declareEndGameAfter`). |

---

## 5. The Merger Bottleneck — Architectural Solution

This is the most important architectural problem to solve. Here is the complete async design.

### 5.1 The Problem Restated

In the live MVP, when Player A triggers a merger, the server immediately prompts Players B and C in sequence, waiting for their socket responses. This is synchronous and requires everyone online.

In the async model, Player A submits their tile. Players B and C might not be online for hours. Player A cannot buy stocks until B and C have decided. The system must track exactly where in the merger sequence we are and whose decision is outstanding.

### 5.2 The Solution: `merger_decisions` as a Queue

When a merger is triggered, the server does NOT try to resolve it immediately. Instead:

**Step 1 — Active player submits their turn tile (with `survivorChoice` if needed).**

The `POST /api/games/:gameId/turn` handler detects the merger, calls `initiateMerger()` from the existing `mergerLogic.js`, then:

- Sets `games.status = 'MERGER_PAUSE'`.
- Stores the merger context in `public_state.mergerContext` in the database (as it does today in memory).
- For the **current defunct chain** (the first in the `defunctQueue`):
  - Calls `computeAndPayBonuses()` immediately (bonuses are deterministic, not a player choice).
  - Identifies which players hold defunct stock and their decision order (using existing `buildDecisionQueue()` logic).
  - Inserts one `merger_decisions` row per player, with `submitted_at = NULL`.
- Sends email notifications to each player in decision order.
- Returns a `MERGER_PAUSE` response to the active player's browser.

**The active player's browser now shows a "Waiting for other players to resolve the merger..." screen.**

**Step 2 — Each non-active player submits their decision via `POST /api/games/:gameId/merger-decision`.**

The handler:
1. Identifies the player's `merger_decisions` row for the current wave.
2. **Enforces sequential order:** Checks that all players with `decision_order` lower than the current player have already submitted (i.e., their `submitted_at` is not NULL). If not, returns a `403 Not your turn yet` error.
3. Validates sell/trade quantities against game state using existing `validateMergerDecision()`.
4. Saves `sell`, `trade`, and `submitted_at = NOW()` to the database row.
5. **Checks if this was the last decision in the queue** (all rows for this wave have `submitted_at` set).
6. If not last: sends a "your turn to decide" email to the next player. Returns `{ status: 'OK' }`.
7. If last: **applies all decisions atomically** (iterates the `merger_decisions` rows in `decision_order`, calls `applyMergerDecision()` for each), then checks if there is another defunct chain in the queue (`mergerContext.defunctQueue`):
   - If yes: calls `advanceMerger()`, inserts new `merger_decisions` rows for the next defunct wave, sends notifications. Stays in `MERGER_PAUSE`.
   - If no: calls `advanceMerger()` which places the trigger tile and clears `mergerContext`. Sets `games.status = 'ACTIVE'`. Sends "complete your turn (buy stocks)" email to the active player.

**Step 3 — Active player returns and completes their turn.**

The client detects `games.status = 'ACTIVE'` and `turnPhase = 'BUY_STOCKS'` on their next poll. They submit stock purchases normally via `POST /api/games/:gameId/turn` (with a `tilePlaced: null` flag or a separate endpoint to be decided during implementation).

### 5.3 Sequential Enforcement Diagram

```
Merger triggered by Player A (seat 0)
Defunct chain: Tower (Players B and C hold stock)

merger_decisions rows inserted:
  row 1: player_id=B, decision_order=1, submitted_at=NULL
  row 2: player_id=C, decision_order=2, submitted_at=NULL

games.status = 'MERGER_PAUSE'

  Player B submits decision:
    → Check: no rows with decision_order < 1 are unsubmitted ✓
    → Save sell/trade, set submitted_at=NOW()
    → rows: [B: SUBMITTED, C: PENDING]
    → Email sent to Player C

  Player C submits decision:
    → Check: row for B (decision_order=1) is submitted ✓
    → Save sell/trade, set submitted_at=NOW()
    → rows: [B: SUBMITTED, C: SUBMITTED]
    → All decisions in — apply all decisions atomically
    → No more defuncts in queue
    → finalizeTrigger(), clear mergerContext
    → games.status = 'ACTIVE', turnPhase = 'BUY_STOCKS'
    → Email sent to Player A: "Resume your turn"

  Player A polls, sees BUY_STOCKS phase, buys stocks, ends turn.
```

### 5.4 What Happens if Player C Can See Player B's Decision

Because `merger_decisions` rows are fetched as part of `GET /api/games/:gameId/state` (the public-facing portion), when Player C loads the game they will see Player B's `sell` and `trade` values. This satisfies the PRD requirement: *"Players must be able to see what the players before them chose to do."*

---

## 6. Phase 1 — Infrastructure & Auth

**Goal:** A working authentication system. A user can log in with Google and see a "logged in as [name]" state. Nothing game-related yet.

### Tasks

1. **Create a Supabase project.**
   - Enable Google OAuth provider in Supabase Auth settings.
   - Configure allowed redirect URLs (localhost + production domain).
   - Note the `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

2. **Add environment variables.**
   - Server: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (for admin JWT validation).
   - Client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

3. **Install packages.**
   - Server: `npm install @supabase/supabase-js`
   - Client: `npm install @supabase/supabase-js`

4. **Create the `users` public table** (SQL from Section 3.2).
   - Add a Supabase Auth trigger: on `INSERT` into `auth.users`, mirror the record into `public.users`.

5. **Server: create a Supabase admin client** (`server/lib/supabase.js`).
   - Initializes the Supabase client with the service role key (bypasses RLS for server-side operations).

6. **Server: create auth middleware** (`server/middleware/auth.js`).
   - Extracts the `Authorization: Bearer` token from the request header.
   - Calls `supabase.auth.getUser(token)` to validate it.
   - Attaches `req.user` to the request, or returns `401`.

7. **Server: add `GET /api/auth/me`** endpoint.
   - Protected by auth middleware. Returns `req.user` profile from `public.users`.

8. **Client: create `supabase.js` singleton.**
   - Initializes the browser Supabase client with the anon key.

9. **Client: add `AuthContext`** (or a Zustand slice).
   - On app load, calls `supabase.auth.getSession()`.
   - Exposes `user`, `signInWithGoogle()`, `signOut()`.
   - `signInWithGoogle()` calls `supabase.auth.signInWithOAuth({ provider: 'google' })`.

10. **Client: add a simple Login page and a placeholder Home page.**
    - Unauthenticated users see the Login page.
    - Authenticated users see "Welcome, [name]" with a logout button.

**Exit Criteria:** A user can click "Sign in with Google", complete the OAuth flow, and land on a page showing their name. The auth token persists across page refreshes.

---

## 7. Phase 2 — Schema, Lobby & Invitations

**Goal:** A host can create a game, invite friends by email, and friends can accept or decline. The host can start the game only when all invites are resolved.

### Tasks

1. **Run the remaining SQL schema** from Section 3.2 in Supabase's SQL editor.
   - `games`, `game_invites`, `game_players`, `game_states` (empty for now), `merger_decisions`, `email_notifications`.

2. **Set up Resend.**
   - Create a Resend account, verify the sender domain (or use their sandbox domain for testing).
   - Add `RESEND_API_KEY` to server environment variables.
   - `npm install resend` on the server.
   - Create `server/lib/email.js`: a wrapper with functions `sendInviteEmail(to, gameName, inviteLink)` and `sendTurnNotificationEmail(to, gameName)`.

3. **Server: implement Lobby API endpoints** (Section 4.2).
   - `POST /api/games` — creates game + adds host to `game_players` at seat 0.
   - `GET /api/games` — queries all games the user is involved in.
   - `GET /api/games/:gameId` — returns game + invites + players.
   - `POST /api/games/:gameId/invite` — inserts invite, sends email.
   - `DELETE /api/games/:gameId/invite/:inviteId` — host cancels invite.
   - `POST /api/games/:gameId/start` — validates all invites resolved, calls `createInitialGameState()`, inserts `game_states` row, sets game status to `ACTIVE`, emails first player.

4. **Server: implement Invite Response endpoints** (Section 4.3).
   - `GET /api/invites` — returns all pending invites for the authenticated user (matched by email).
   - `POST /api/invites/:inviteId/accept` — updates invite status, creates `game_players` row, assigns next available seat order.
   - `POST /api/invites/:inviteId/decline` — updates invite status.

5. **Client: build the Lobby UI.**
   - **Home page:** "Create Game" button + list of existing games (with status badges) + list of pending invites.
   - **Game Lobby page:** Shows invited players with their invite status. Host sees an "Invite Another Player" input (email address). "Start Game" button — disabled if any invite is PENDING, active otherwise.
   - **Invite acceptance flow:** Clicking the link in the email brings the user to the app; they log in and see the pending invite with Accept / Decline buttons.

**Exit Criteria:** Host creates a game, invites two players by email, both receive emails, one accepts, one declines. Host clicks Start Game. Game record transitions to `ACTIVE`. First player receives a "your turn" email.

---

## 8. Phase 3 — Core Async Turn Logic

**Goal:** A complete game can be played asynchronously without mergers. Players take turns placing tiles and buying stocks across separate browser sessions.

### Tasks

1. **Server: implement `GET /api/games/:gameId/state`.**
   - Reads from `game_states`.
   - Returns `public_state` + the requesting player's tile hand (from `player_tiles[userId]`).
   - Does NOT return `draw_pile`.

2. **Server: implement `POST /api/games/:gameId/turn`.**
   - Auth middleware validates the caller is the active player.
   - Deserialize `public_state`, `player_tiles`, `draw_pile` from `game_states`.
   - Process the turn using the existing game logic modules (the functions in `server/game/` are pure functions and can be called directly — they operate on the in-memory state object):
     - Tile placement: `boardLogic.js`
     - Chain founding / growing: `chainLogic.js`
     - Stock purchasing: `stockLogic.js`
     - Tile drawing: `tileLogic.js`
     - End game: `GameState.js` (checkEndGameConditions, executeEndGamePayouts)
   - Merger detection triggers the MERGER_PAUSE flow (full implementation in Phase 4; stub it out here to return an error for now).
   - Re-serialize the updated state back to `game_states`.
   - Update `games.status` if the game ended.
   - Send "your turn" email to the next player.
   - Return the updated public state + the active player's new tile hand.

3. **Server: create `server/lib/gameStateDb.js`.**
   - `loadGameState(gameId)` — reads from `game_states`, returns `{ publicState, playerTiles, drawPile }`.
   - `saveGameState(gameId, publicState, playerTiles, drawPile)` — upserts `game_states`.
   - Centralizes all DB serialization logic.

4. **Client: remove Socket.io.**
   - Uninstall `socket.io-client`.
   - Remove all `useSocket`, `socket.emit`, `socket.on` references.

5. **Client: add an API client module** (`client/src/lib/api.js`).
   - A thin wrapper around `fetch` that attaches the Supabase JWT to every request.
   - Functions: `getGameState(gameId)`, `submitTurn(gameId, turnData)`, etc.

6. **Client: implement game state polling.**
   - In the Game page component, use `setInterval` (or a React Query polling setup) to call `getGameState(gameId)` every 10 seconds.
   - Update the Zustand store with the new state on each successful response.
   - Cancel the interval on component unmount.

7. **Client: refactor turn submission.**
   - Remove all intermediate socket events (tile placed → name chain → buy stocks as separate events).
   - The player now builds their entire turn in local state (the Zustand `turnDraft` slice).
   - "End Turn" button calls `submitTurn(gameId, turnDraft)`.
   - On success, update game state from the response.

8. **Client: refactor the Zustand store.**
   - Remove the socket-driven `useSocketStore`.
   - Add a `useGameStore` with:
     - `gameState` (public state from server)
     - `myTiles` (private tile hand)
     - `turnDraft` (local draft state: placed tile, stocks to buy)
     - `isMyTurn` (computed: `gameState.players[gameState.activePlayerIndex].id === me.id`)

**Exit Criteria:** Two players can complete a full game (without mergers) over separate browser sessions. State persists across server restarts.

---

## 9. Phase 4 — Merger Sequence Logic

**Goal:** Mergers work correctly in the async model. All players resolve their decisions sequentially, and the active player's turn resumes after all decisions are in.

### Tasks

1. **Server: complete the merger path in `POST /api/games/:gameId/turn`.**
   - When `initiateMerger()` returns a result requiring decisions:
     - Call `computeAndPayBonuses()` for the first defunct chain.
     - Build the decision queue using existing logic.
     - Insert `merger_decisions` rows (one per player with defunct stock).
     - Set `games.status = 'MERGER_PAUSE'`.
     - Save the updated game state (with `mergerContext` in `public_state`).
     - Send "merger decision needed" emails.
     - Return a `{ status: 'MERGER_PAUSE' }` response.
   - Note: If the merger is triggered by tile placement but requires a `survivorChoice` (tie), the client includes `survivorChoice` in the initial `POST /api/games/:gameId/turn` body. The server calls `applySurvivorChoice()` before inserting merger_decisions rows.

2. **Server: implement `POST /api/games/:gameId/merger-decision`.**
   - Validate the caller has an outstanding `merger_decisions` row (`submitted_at IS NULL`).
   - Validate sequential order: all rows with lower `decision_order` must have `submitted_at IS NOT NULL`.
   - Read current game state from `game_states`.
   - Validate the decision with `validateMergerDecision()`.
   - Save `sell`, `trade`, `submitted_at = NOW()` to the `merger_decisions` row.
   - **Check if all decisions for this wave are submitted:**
     - If no: send "your turn" email to the next player. Return `{ status: 'OK' }`.
     - If yes: apply all decisions in order using `applyMergerDecision()`, then call `advanceMerger()`.
       - If `advanceMerger()` returns `phase: 'MERGER_DECISIONS'`: insert new `merger_decisions` rows for the next defunct wave, send emails.
       - If `advanceMerger()` returns `phase: 'BUY_STOCKS'`: set `games.status = 'ACTIVE'`, send "resume your turn" email to the active player.
   - Save updated game state.

3. **Server: include merger decision data in `GET /api/games/:gameId/state`.**
   - When `games.status = 'MERGER_PAUSE'`, fetch all `merger_decisions` rows for the current game and current `defunctWave`.
   - Include them in the response so players can see who has decided and what they chose.

4. **Client: add Merger Decision UI.**
   - When the player is not the active player but has an outstanding `merger_decisions` row, show the Merger Resolution panel.
   - Display the defunct chain, the player's current holdings, and previously submitted decisions by other players (from the `merger_decisions` data in the state response).
   - Sell / Trade / Keep inputs, with a "Submit Decision" button that calls `POST /api/games/:gameId/merger-decision`.

5. **Client: show "Waiting on merger" state for the active player.**
   - When `games.status = 'MERGER_PAUSE'` and it's the active player's session, show a read-only view of the merger progress (who has decided, who is pending) with the message "Waiting for other players to resolve the merger."

**Exit Criteria:** A merger triggers, pauses the game, collects decisions from each non-active player in order (each seeing prior decisions), applies them, and correctly resumes the active player's stock-buying phase.

---

## 10. Phase 5 — Frontend Migration

**Goal:** The client UI is fully migrated to the async model. All screens are complete and match the MVP feature set.

### Tasks

1. **Auth screens:** Login page, logged-in home page with user avatar/name.
2. **Lobby screens:** Create game, invite players, pending invites page, lobby waiting room with invite status list.
3. **Game screen:** Full board, chain info panel, stock bank, player info panel — all driven by polled REST state.
4. **Turn flow UI:**
   - Tile hand display with playability highlighting (using existing client-side logic).
   - "Turn Draft" panel: shows the tile placed, stocks being added.
   - "End Turn" button (submits the entire draft).
   - "Declare End Game" button (available when `endGameAvailable` is true).
5. **Chain founding UI:** When a founding tile is placed, a modal prompts for chain name selection (stored in the draft, submitted with the turn).
6. **Merger UI:** Survivor choice modal (for ties), Merger Resolution panel for non-active players, "Waiting on merger" panel for the active player.
7. **End game screen:** Final standings, winner announcement.
8. **Notifications:** A small "You have a pending game action" badge visible on the home page for games awaiting the user's merger decision.

---

## 11. Phase 6 — Deployment & Cutover

**Goal:** The new async version is live on the production host and the old socket-based version is retired.

### Tasks

1. **Deploy Supabase project** (already hosted; just ensure environment variables are set).
2. **Set environment variables** on the host (Railway/Render): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `RESEND_API_KEY`.
3. **Update the build script** to remove the Socket.io server dependency and confirm the monolithic build still works (Express serves `client/dist`).
4. **Test end-to-end** with a full 3-player game across real async sessions.
5. **Retire the old in-memory game state** — remove `rooms/roomManager.js` and all socket handler files once the REST handlers are confirmed working.

---

## 12. What We Are Keeping From the MVP

The existing game logic modules are pure functions that operate on a plain JavaScript object. They do not depend on Socket.io or in-memory storage. They can be used almost unchanged in the new architecture.

| File | Status | Notes |
|---|---|---|
| `server/game/GameState.js` | **Keep** | `createInitialGameState`, `checkEndGameConditions`, `executeEndGamePayouts` all reused directly |
| `server/game/boardLogic.js` | **Keep** | Pure board computation, no changes needed |
| `server/game/chainLogic.js` | **Keep** | Pure chain logic, no changes needed |
| `server/game/stockLogic.js` | **Keep** | Pure stock logic, no changes needed |
| `server/game/tileLogic.js` | **Keep** | Pure tile logic, no changes needed |
| `server/game/mergerLogic.js` | **Keep** | All functions reused; the async layer wraps around them |
| `server/rooms/roomManager.js` | **Delete** | Replaced by the `games` / `game_players` tables |
| `server/socketHandlers/lobbyHandlers.js` | **Delete** | Replaced by the Lobby REST API |
| `server/socketHandlers/gameHandlers.js` | **Delete** | Replaced by the Turn REST API |
| `server/index.js` | **Rewrite** | Remove Socket.io, add REST route registration |
| `client/src/*` (all components) | **Refactor** | Remove socket calls, add polling + REST submission |

---

*End of Technical Development Plan*
