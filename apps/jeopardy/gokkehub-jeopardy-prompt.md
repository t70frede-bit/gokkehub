# GokkeHub Jeopardy — Claude Code Implementation Prompt

## Project Context

You are working inside the GokkeHub monorepo. GokkeHub is a browser-based multiplayer party game platform built on:

- **Frontend:** React (Vite), TypeScript (`.tsx`/`.ts` everywhere — no `.js`/`.jsx`), deployed to Cloudflare Pages
- **Backend:** Cloudflare Pages Functions in a `functions/` directory per app — do NOT create a separate standalone Cloudflare Worker with its own wrangler config. Follow the same pattern as `apps/timelinedrop/functions/room/` for all server-side endpoints, including the buzz handler.
- **Database:** Supabase (Postgres + Realtime + Storage) — this is where all game state lives. D1 is NOT used for this app.
- **Session/KV:** Cloudflare KV (`gokkehub_sessions`, binding `SESSIONS`) — used only for cross-subdomain session lookup, never for game state
- **Auth:** Discord OAuth via the shared auth flow. Identity lives in Supabase Auth (`auth.users` + `user_metadata`) — there is **no `profiles` table**. Profile fields are updated via `supabase.auth.admin.updateUserById(...)` with `user_metadata`; see `apps/account/functions/profile/update.ts` for the canonical pattern.
- **Shared packages:** `@gokkehub/ui` (components: `Button`, `Input`, `Panel`, …), `@gokkehub/auth` (`requireAuth`, `updateSession`, `getSessionId`), `@gokkehub/db` (`createSupabaseAdminClient`), `@gokkehub/config` (base Tailwind config)

Scaffold the game as `apps/jeopardy`, following the same conventions as `apps/timelinedrop` and `apps/poker`. The game is served at `jeopardy.gokkehub.com`.

**Look at `apps/timelinedrop` before writing any code** — match its `package.json` workspace setup, TypeScript config, Vite config, Pages Functions structure (`functions/_env.ts`, `functions/_supabase.ts`), Supabase client setup (`src/lib/supabase.ts`), types module (`src/lib/types.ts`), and Realtime hook pattern (`src/hooks/useRoom.ts`) exactly.

---

## Architecture Notes

### Language
All files are TypeScript. `.tsx` for React components, `.ts` for everything else.

### Backend: Pages Functions, not standalone Workers
The buzz handler and all other server-side logic live in `apps/jeopardy/functions/`. This deploys alongside the frontend with no separate wrangler config and no CORS wiring. Client-side reads go directly through the Supabase anon client; all mutations that must be trusted (buzz resolution, scoring, power-up grants) go through Pages Functions using the service-role client.

### Database: Supabase only, `jp_` table prefix
All tables in the shared Supabase project are prefixed per game (`tl_*` for timelinedrop). Jeopardy tables use the **`jp_`** prefix: `jp_games`, `jp_rooms`, `jp_teams`, `jp_players`, `jp_buzz_attempts`, `jp_game_events`.

Migrations are plain SQL files in the app root, numbered sequentially (`supabase-migration.sql`, `supabase-migration-002.sql`, …), run manually in the Supabase SQL editor — same as timelinedrop. Each migration must:
- `ALTER PUBLICATION supabase_realtime ADD TABLE <table>` for every table clients subscribe to
- Enable RLS with **open read + service-role-only write** (same pattern as timelinedrop/gridchallenge)

### Realtime: `postgres_changes` on tables, not broadcast channels
GokkeHub games do NOT use Supabase broadcast events. Live state flows through **table changes**: clients open one channel per room (`.channel(\`room:${roomId}\`)`) and subscribe with `postgres_changes` filtered per table (`filter: \`room_id=eq.${roomId}\``) — see `apps/timelinedrop/src/hooks/useRoom.ts`. Mutations happen server-side (Pages Functions) or via allowed client writes; subscribers react to the row changes. Ephemeral signals (e.g. a power-up swap prompt) are modelled as short-lived rows or fields in `board_state`, not as broadcast messages.

### Join flow: centralised hub routing — the app still needs its own `/join` page
`gokkehub.com/join` resolves room codes via `apps/web/functions/api/find-room.ts`, which probes each game's own rooms table (`id=eq.{CODE}`) and redirects to `{app}/join?room={CODE}`. There is no shared lookup table. Integration requires:

1. `jp_rooms.id TEXT PRIMARY KEY` **is the room code itself** (uppercase, 4–12 alphanumeric — must pass find-room's `/^[A-Z0-9]{4,12}$/` check), matching `tl_rooms`
2. Add a jeopardy entry to the `GAMES` array in `apps/web/functions/api/find-room.ts`: `{ table: "jp_rooms", url: "https://jeopardy.gokkehub.com", label: "jeopardy" }`
3. Build a `JoinPage.tsx` in the jeopardy app that reads the `?room=` query param, loads the room + teams, and lets the player enter a name (pre-filled from `useSession`) — mirror `apps/timelinedrop/src/pages/JoinPage.tsx`

The big screen shows the room code and a QR code pointing at the hub join URL. Don't advertise a jeopardy-specific join URL to players; the `/join` route exists to receive the hub redirect.

### Buzzer race condition: collection window via `jp_buzz_attempts`
Pages Functions are stateless — each buzz arrives as an independent HTTP request, possibly on different isolates, so the collection window **cannot** be held in memory. Implement it through Postgres, which also gives one authoritative clock:

1. Every buzz request inserts a row into `jp_buzz_attempts` (timestamp = Postgres `now()`, never client time or isolate time). The insert also records the current `buzz_round` so re-buzzes after a wrong answer are a fresh race.
2. The insert RPC returns the row's rank within `(room_id, tile_key, buzz_round)`. If this request's row ranked **first**, that Pages Function `await`s the configured collection window (default 300 ms), then calls the resolution RPC. Non-first requests return immediately.
3. The resolution RPC (`jp_resolve_buzz`) selects all attempts in the window, subtracts the Sniper advantage ms from any attempt whose team holds Sniper, and picks the lowest adjusted timestamp.
4. The winner is written atomically with a conditional update — `UPDATE jp_rooms SET board_state = jsonb_set(...) WHERE id = $room AND board_state->'activeQuestion'->>'buzzedBy' IS NULL`. If zero rows update, another instance already resolved; do nothing.
5. Clients learn the winner via the `postgres_changes` event on `jp_rooms`.
6. In **Queue Lock-In** mode, the losing attempts (ordered by adjusted timestamp) become the buzz queue — read them straight from `jp_buzz_attempts`, no separate queue bookkeeping.

Never trust client-sent timestamps. Postgres `now()` at insert is authoritative.

### Buzzer sound: `user_metadata`, not a profiles migration
Buzzer sounds are a **profile-level** setting shared across all GokkeHub games. Since identity lives in Supabase Auth:
- The sound file goes in Supabase Storage at `buzzer-sounds/{user_id}/`
- Its URL is stored in `user_metadata.buzzer_sound_url` via `supabase.auth.admin.updateUserById` — same pattern as `apps/account/functions/profile/update.ts`
- The upload/record/select UI belongs in **`apps/account`** (the profile app), not in jeopardy; jeopardy only reads the URL when a player wins a buzz

### Styling & Tailwind
- Extend the shared base config: `import baseConfig from "@gokkehub/config/tailwind"`
- The `content` array MUST include `"../../packages/ui/src/**/*.{ts,tsx}"` alongside `"./index.html"` and `"./src/**/*.{ts,tsx}"` — otherwise shared component styles get purged
- Use `@gokkehub/ui` components (`Button`, `Input`, `Panel`, …) and follow the existing design system (warm charcoal + amber, "vinyl liner notes" v0.2)

### Deployment
Add a `deploy-jeopardy` job to `.github/workflows/deploy.yml`, mirroring the `deploy-poker` job exactly: checkout + install the full repo, `npm run build --workspace=apps/jeopardy`, then `pages deploy dist --project-name=jeopardy --branch=main` from `apps/jeopardy`. The `jeopardy.gokkehub.com` subdomain is wired via the Cloudflare Pages custom-domain flow like the other apps. Do not touch the existing jobs.

---

## Application Overview

A host-controlled Jeopardy-style party game with three distinct views:

1. **Big Screen / Board View** — TV or projector; shows the game board, scores, podiums, active question. Landscape-optimised. No interaction required from this device.
2. **Host Controller** — host's phone; full game management. Mobile-optimised portrait layout.
3. **Player View** — each player's phone; buzzer, power-up status, answer input. Mobile-optimised portrait layout, large touch targets.

Players join via the centralised hub room code. The host manages all game flow from their phone. The big screen is a passive display driven entirely by game state.

---

## User Flow

### 1. Landing & Auth
- User visits `jeopardy.gokkehub.com`
- If not logged in via Discord OAuth, prompt login (reuse existing GokkeHub auth flow via `@gokkehub/auth` and the `SESSIONS` KV binding)
- Logged-in users land on a dashboard showing:
  - **Create New Game** button
  - **My Games** list: draft, active (resumable), and completed games
  - Each game card shows: title, date, team count, status, thumbnail of board config

### 2. Game Creation — Setup Wizard

A multi-step setup flow. All config is saved to `jp_games` as a draft on each step so the host can return and continue.

#### Step 1: General Settings
- Game title
- Number of teams: 2–8 (recommended max 4; show a visible warning above 4)
- Team buzzer mode:
  - Shared — any team member's buzz counts for the team
  - Captain only — one designated buzzer per team
  - Every member — all members have individual buzzers
- Whether device-required answer modes (ranking, closest number, multiple choice) show only on the captain's device in team mode

#### Step 2: Board Configuration
- Number of boards: 1 or 2
- Per board:
  - Number of categories (columns): configurable
  - Number of rows: configurable
  - Point value per row: host sets manually (e.g. row 1: 100, row 2: 200, etc.)
- If 2 boards:
  - **Double-up mode:** board 2 mirrors board 1 with 2× point values
  - **Custom mode:** board 2 independently configured
  - **Power-up carry-over:** persist upgrades into board 2, or reset so players earn fresh ones

#### Step 3: Question Builder
Each tile on the board opens the Question Builder. This is a **block-based editor** (think simplified Notion) with two sides built independently: **Question Side** and **Answer Side**.

**Available blocks — drag to add, reorder by dragging:**

- **Text block** — rich text input
- **Image block** — upload or drag in; crop/resize in side panel; on Question Side, exposes Reveal Mode:
  - Off (normal)
  - Silhouette — blacked out, shape only visible
  - Static pixelated/blurred
  - Animated reveal — slowly sharpens over time via CSS filter animation (`blur(20px)` → `blur(0)`) or canvas pixelation
- **Audio block** — upload or record in browser (mic capture); settings:
  - Waveform trimmer (set start and end point)
  - Fade in / fade out toggle
  - On-buzz behaviour: stop immediately | fade out | continue playing
- **Video block** — upload; settings:
  - Timeline trimmer (set start and end point)
  - Fade in / fade out toggle
  - On-buzz behaviour: stop | freeze frame | continue playing
  - Mute video toggle

All media uploads go to Supabase Storage.

Clicking a block opens a **side settings panel** — never inline. The editor surface stays clean.

**Question types emerge from block combinations — there is no explicit type selector.** Common patterns:
- Text + Text answer → classic
- Image + Text answer → image question
- Audio + Text + Audio answer + Text answer → audio question
- Video + Text answer → video question
- Image (reveal mode) + Text answer → silhouette/reveal question

A **"Preview as Player"** button renders exactly what players and the big screen will see, including animations and buzz behaviour.

#### Step 4: Answer Mode (per question; board-level default settable)

Decoupled from question blocks — any question can use any answer mode:

- **Standard — Buzz to Answer**
  - Host selects which individual blocks disappear when a player buzzes in (configurable per block)
  - Buzz-in display mode (also board-level default, overridable per question):
    - **Disappear** — question vanishes on buzz
    - **Typewriter** — types out letter by letter, freezes mid-sentence on buzz
    - **Stay** — question stays fully visible after buzz

- **Multiple Choice**
  - Host enters up to 8 options, marks one correct
  - Options scrambled randomly on display
  - Host configures: close on first correct answer, or let remaining players guess

- **Closest Number**
  - Input type: free number field or slider
  - Slider: host sets min and max
  - Unit label: free text field (Kr., Thousand Kr., Millions, %, km, etc.)
  - Tie-break: first to submit wins

- **Ranking**
  - Host enters up to 8 items and sets correct order
  - Displayed in randomised order on player phones
  - Scoring: all-or-nothing (exact order) or partial credit per correctly placed item

#### Step 5: Buzzer Settings
- Queue behaviour:
  - **Must Re-Buzz** — buzzers locked during answer, everyone competes fresh when reopened (a new `buzz_round` starts)
  - **Queue Lock-In** — players who buzz during another's answer time are queued in order (read from `jp_buzz_attempts`), automatically called next if previous player is wrong
- Answer timer: visible per-player stopwatch, no auto-cutoff, host decides when time is up
- Sniper advantage: configurable ms (100 / 200 / 300ms or custom input)
- Buffer flat reduction value: configurable points (e.g. 50, 100, 150)
- Collection window ms (default 300)

#### Step 6: Special Tiles
All special tiles are visually identical to normal tiles — no glow, no icon, completely indistinguishable until clicked.

**Power-Up Tiles** (each individually enable/disable; placement per power-up: random within row range or manual on a visual board grid):

- ⚡ **Sniper** — permanent buzz head-start (configured ms applied during the collection window)
- 🛡️ **Buffer** — permanent flat reduction on wrong-answer point loss (e.g. lose 300 → lose 200 at 100pt reduction)
- 🎯 **Second Chance** — answer twice per buzz:
  - Wrong + Wrong → lose 2× tile value
  - Wrong + Right → net zero (score unchanged)
  - Right → normal, second attempt unused

**Unlock mechanic:** When a player picks a power-up tile and answers correctly, they see a choice: take the points or claim the power-up. Wrong answer = points deducted as normal, tile disappears. If no one ever picks the tile, it disappears without effect.

**One power-up slot per player.** Earning a second prompts a public swap decision shown on the big screen (keep current or replace). Time-limited (configurable, e.g. 15 seconds) or host forces choice. All players' active upgrades always visible on the big screen.

**Dangerous Tiles:**
- 💥 **Buzzed** — player who picked this tile is automatically buzzed in and must answer. Other players may buzz in after, following the configured queue behaviour.

#### Step 7: Final Jeopardy (optional toggle)
- Host writes one question using the Question Builder
- All players wager points before the question is revealed (cannot wager more than current score)
- Players type their answers on their phones and submit
- Host reviews each answer on host controller, marks correct/incorrect
- Points awarded/deducted per wager

#### Step 8: Buzzer Sound (profile-level, lives in `apps/account`)
Buzzer sounds carry across all GokkeHub games, so the selection/record/upload UI belongs on the profile page in `apps/account`, with the file in Supabase Storage (`buzzer-sounds/{user_id}/`) and the URL in `user_metadata.buzzer_sound_url` (see Architecture Notes). Jeopardy links to it from the lobby ("set your buzzer sound") and reads it during play.

- Selection of 5–8 built-in sounds
- Record custom (browser mic, 2–3 seconds max)
- Upload audio or video file (trimmed to 2–3 seconds; if video, clip plays on big screen on buzz)

When a player wins the buzz: their sound/clip plays on the big screen, their podium lights up with a glow animation.

### 3. Lobby

Host launches the game from the dashboard:
- A `jp_rooms` row is created — its `id` is the generated room code, which makes it immediately discoverable by `gokkehub.com/api/find-room`
- Room code and QR code (pointing at the hub join URL) displayed on big screen
- Players join via `gokkehub.com/join` → hub redirects to `jeopardy.gokkehub.com/join?room={CODE}`
- Player names pre-filled from Discord session if logged in
- Host assigns players to teams or uses random auto-assign
- Host designates team captains
- Big screen shows lobby: connected players, team assignments (live via `postgres_changes` on `jp_players` / `jp_teams`)
- Host starts when ready

### 4. Gameplay

#### Big Screen Layout
- Top: category headers (hidden until host reveals each one)
- Main: board grid — tiles show point values, flip animation when selected, fade when spent
- Bottom: team podiums showing team name, score, active power-up icon (or empty slot), buzz-in glow indicator, member names
- Active question overlay slides up over the board when a tile is selected

#### Host Controller Flow (per question)
1. Board shown — host or player selects a tile
2. Question content revealed on big screen per the configured reveal/typewriter/stay mode
3. Buzzers open (host taps open, or auto-open after configurable delay)
4. Player buzzes — collection window runs, Sniper offsets applied, winner resolved server-side (see Architecture Notes)
5. Winner's sound/clip plays on big screen, their podium lights up
6. Host controller shows: buzz order queue, answer timer, full question + correct answer
7. Host accepts or rejects answer:
   - Correct → points awarded; if power-up tile, choice prompt shown publicly
   - Wrong → points deducted (Buffer applied if held); next in queue called if Queue Lock-In
8. Host resets buzzers for next question

#### Player Phone Flow
- Large full-screen buzzer button (standard mode)
- Clear locked/open state
- Queue position shown in Queue Lock-In mode
- On winning buzz: answer prompt displayed, timer visible
- Multiple choice: option buttons replace buzzer
- Closest number: input field or slider
- Ranking: drag-and-drop list (captain only in team mode)
- Active power-up icon at top, current score visible

#### Answer Timer
Starts on buzz win. Visible on host controller and big screen. No automatic cutoff — host decides.

### 5. Between Boards (if 2 boards)
- Scoreboard shown on big screen with animation
- If power-up reset configured: animation showing all upgrades wiped
- Host advances to board 2

### 6. Final Jeopardy (if enabled)
- Category revealed, wagering opens on player phones
- Host reveals question
- Players type and submit answers
- Host marks each answer correct/incorrect on host controller
- Final scores revealed with animation

### 7. Post-Game Screen
Shown on big screen and player phones:
- Winner announcement with animation
- Full final scoreboard
- Stats (sourced from the `jp_game_events` log):
  - Most correct answers
  - Most wrong answers
  - Biggest single point gain
  - Longest correct streak
  - Power-up usage (who used what, when)
  - First-to-buzz win rate per player
- Rematch button (relaunch same game config, reset all scores and state)
- Game auto-saved to host's history

### 8. Game Persistence
- State auto-saved to Supabase on every change (it's the source of truth — nothing lives only in client memory)
- Host can pause and close; resume from dashboard restores everything: scores, spent tiles, power-ups held, buzz queue, active board
- Completed games archived and viewable from dashboard

---

## Data Model (Supabase Postgres, `jp_` prefix)

Two concepts are deliberately separated, matching the dashboard flow: **`jp_games`** holds the reusable setup-wizard output (drafts, rematches, history); **`jp_rooms`** is one live play session of a game, keyed by the room code.

### `jp_games` — saved game configs
```sql
CREATE TABLE IF NOT EXISTS jp_games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id     TEXT NOT NULL,          -- Supabase Auth user id (no FK; matches tl_rooms.host_id convention)
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft | ready | archived
  config      JSONB NOT NULL DEFAULT '{}',    -- full setup wizard output (see below)
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### `jp_rooms` — live sessions (probed by find-room; id IS the room code)
```sql
CREATE TABLE IF NOT EXISTS jp_rooms (
  id           TEXT PRIMARY KEY,      -- room code, uppercase alphanumeric 4–12 chars
  game_id      UUID NOT NULL REFERENCES jp_games(id),
  host_id      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'lobby',  -- lobby | playing | paused | finished
  board_state  JSONB NOT NULL DEFAULT '{}',    -- live mutable game state (see below)
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
```

### `jp_teams` / `jp_players` — relational, like `tl_teams` / `tl_players`
```sql
CREATE TABLE IF NOT EXISTS jp_teams (
  id          SERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES jp_rooms(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  score       INT  NOT NULL DEFAULT 0,
  powerup     TEXT,                   -- 'sniper' | 'buffer' | 'secondChance' | NULL
  captain_id  TEXT,                   -- jp_players.id
  sort_order  INT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jp_players (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES jp_rooms(id) ON DELETE CASCADE,
  team_id    INT REFERENCES jp_teams(id),
  name       TEXT NOT NULL,
  user_id    TEXT,                    -- Supabase Auth user id if logged in (for buzzer sound lookup)
  connected  BOOLEAN NOT NULL DEFAULT true,
  joined_at  TIMESTAMPTZ DEFAULT now()
);
```

### `jp_buzz_attempts` — the buzz race (see Architecture Notes)
```sql
CREATE TABLE IF NOT EXISTS jp_buzz_attempts (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES jp_rooms(id) ON DELETE CASCADE,
  tile_key    TEXT NOT NULL,          -- e.g. "0-0"
  buzz_round  INT  NOT NULL,          -- increments on every re-buzz so each race is fresh
  team_id     INT  NOT NULL,
  player_id   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()  -- authoritative timestamp
);
```

### `jp_game_events` — drives all post-game stats
```sql
CREATE TABLE IF NOT EXISTS jp_game_events (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES jp_rooms(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,  -- 'buzz_win' | 'answer_correct' | 'answer_wrong' | 'powerup_claimed' | 'powerup_swapped' | 'tile_selected' | ...
  team_id     INT,
  player_id   TEXT,
  payload     JSONB,          -- tile key, points delta, power-up type, etc.
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

Insert a row for every meaningful game event during play — if events are missed, stats will be wrong. Wire event logging from the start.

### Realtime + RLS (every migration)
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE jp_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE jp_teams;
ALTER PUBLICATION supabase_realtime ADD TABLE jp_players;
-- (jp_buzz_attempts / jp_game_events only if clients need to observe them live,
--  e.g. queue position display in Queue Lock-In mode)

-- RLS: open read + service-role write, same as tl_* / gridchallenge tables
```

### `user_metadata` (Supabase Auth — no table migration)
```
buzzer_sound_url  -- path in Supabase Storage buzzer-sounds/{user_id}/, set via apps/account
```

### `config` JSONB structure (on `jp_games`)
```jsonc
{
  "teams": {
    "count": 4,
    "buzzerMode": "shared|captain|all",
    "captainOnlyDeviceQuestions": true
  },
  "boards": [
    {
      "categories": ["Category 1", "Category 2"],
      "rows": 5,
      "pointValues": [100, 200, 300, 400, 500],
      "tiles": {
        "0-0": {
          "questionBlocks": [ /* block objects */ ],
          "answerBlocks":   [ /* block objects */ ],
          "answerMode": "standard|multipleChoice|closestNumber|ranking",
          "answerModeConfig": { /* mode-specific config */ },
          "buzzDisplayMode": "disappear|typewriter|stay",
          "specialTile": null
          // specialTile values: "powerup_sniper" | "powerup_buffer" | "powerup_secondChance" | "buzzed"
        }
      }
    }
  ],
  "powerups": {
    "sniper":       { "enabled": true, "advantageMs": 200, "placement": "random|manual", "rowRange": [1,2] },
    "buffer":       { "enabled": true, "reductionAmount": 100, "placement": "random|manual", "rowRange": [4,4] },
    "secondChance": { "enabled": true, "placement": "random|manual", "rowRange": [3,4] }
  },
  "buzzer": {
    "queueMode": "rebuzz|lockIn",
    "defaultBuzzDisplayMode": "disappear|typewriter|stay",
    "collectionWindowMs": 300
  },
  "finalJeopardy": {
    "enabled": true,
    "questionBlocks": [],
    "answerBlocks": []
  },
  "board2Mode": "doubleUp|custom",
  "powerupCarryover": "persist|reset"
}
```

### `board_state` JSONB structure (on `jp_rooms`)
Team scores/power-ups/membership live in the relational tables above; `board_state` holds only board-level progress:
```jsonc
{
  "currentBoard": 0,
  "spentTiles": ["0-0", "0-2"],
  "revealedCategories": [0, 1],
  "buzzersOpen": false,
  "buzzRound": 3,
  "activeQuestion": null
  // or:
  // "activeQuestion": {
  //   "tileKey": "1-3",
  //   "buzzedBy": null,            // set atomically by jp_resolve_buzz
  //   "buzzedPlayerId": null,
  //   "timerStart": null,          // ms epoch, set when buzz resolves
  //   "secondChanceUsed": false
  // }
}
```

### Live updates (per-table `postgres_changes` subscriptions in `useRoom`)
```
jp_rooms    → board state: tiles spent, categories revealed, buzzers open/locked,
              active question, buzz winner, board advance, status changes
jp_teams    → scores, power-ups held/claimed/swapped, captain changes
jp_players  → lobby joins/leaves, connection state, team assignment
jp_buzz_attempts (INSERT) → live queue position display in Queue Lock-In mode
```
Ephemeral UI prompts (power-up choice, swap decision) are fields inside `activeQuestion` / `board_state`, cleared when resolved — not broadcast messages.

---

## File & Folder Structure

Mirror timelinedrop's layout (`src/pages/`, `src/lib/`, `src/hooks/` — note: **pages**, not views):

```
apps/jeopardy/
  supabase-migration.sql    # tables, realtime publication, RLS, RPCs
  index.html
  package.json              # workspace member, matches timelinedrop's setup
  tailwind.config.ts        # extends @gokkehub/config/tailwind, content includes packages/ui
  postcss.config.js
  functions/
    _env.ts                 # Env interface (SUPABASE_URL, SERVICE_ROLE_KEY, SESSIONS, ...)
    _supabase.ts            # service-role helpers
    api/
      buzz.ts               # buzz attempt insert + collection window + resolve
      game-action.ts        # host actions: open/lock buzzers, accept/reject, score edits, advance
      room.ts               # create jp_rooms row (code generation), rematch
  src/
    main.tsx
    App.tsx                 # routes: /, /setup, /join, /lobby, /host, /screen, /play, /end
    styles.css
    lib/
      supabase.ts           # anon client
      types.ts              # JpGame, JpRoom, JpTeam, JpPlayer, config/board_state types
    pages/
      DashboardPage.tsx     # game list, create button
      SetupWizardPage.tsx   # multi-step game creation
      JoinPage.tsx          # receives hub redirect (?room=CODE)
      LobbyPage.tsx         # room code, QR, team assignment
      BigScreenPage.tsx     # board display, podiums
      HostControllerPage.tsx
      PlayerPage.tsx        # buzzer + answer input
      PostGamePage.tsx      # results and stats
    components/
      QuestionBuilder/
        BlockEditor.tsx
        TextBlock.tsx
        ImageBlock.tsx
        AudioBlock.tsx
        VideoBlock.tsx
        BlockSettingsPanel.tsx
        PreviewModal.tsx
      Board/
        BoardGrid.tsx
        Tile.tsx
        CategoryHeader.tsx
        QuestionOverlay.tsx
      Podium/
        PodiumStrip.tsx
        PowerUpIcon.tsx
      AnswerModes/
        StandardBuzzer.tsx
        MultipleChoice.tsx
        ClosestNumber.tsx
        Ranking.tsx
      PowerUpPrompt.tsx
      BuzzerButton.tsx
      AnswerTimer.tsx
    hooks/
      useSession.ts         # cross-subdomain session (copy timelinedrop's)
      useRoom.ts            # postgres_changes subscriptions per table (mirror timelinedrop's)
      useBuzzer.ts          # buzz button state, lockout, queue position
      useHostController.ts  # host action dispatchers → Pages Functions
```

Also touched outside the app:
```
apps/web/functions/api/find-room.ts   # add jp_rooms entry to GAMES array
apps/account/...                      # buzzer sound UI on profile page (later pass)
.github/workflows/deploy.yml          # add deploy-jeopardy job (mirror deploy-poker)
```

---

## Scope Notes for the Implementer

Be aware of the following before estimating effort:

- **The Question Builder alone is a large sub-project.** Audio waveform trimming, video timeline trimming, in-browser mic recording, and animated pixelation/blur reveal are each non-trivial. The full builder is roughly a `timelinedrop`-sized build by itself.
- **The buzzer sound feature spans two apps** (`apps/account` for the UI, jeopardy for playback) and touches `user_metadata` used by all games. Build it as its own pass.
- **Post-game stats** require `jp_game_events` rows to be written consistently throughout play. Wire event logging from the start, not as an afterthought.
- **Team mode + all answer modes + power-ups** interacting correctly is significant state management complexity. Keep the state machine in `board_state` explicit and transition through Pages Functions, not client-side mutations.

---

## MVP Cut — Build This First

Get a playable game running before tackling the full feature set. MVP scope:

**Include:**
- Text blocks only (no audio, video, or reveal image)
- Standard buzz-to-answer mode only
- No power-ups, no dangerous tiles
- Single board only
- Must Re-Buzz queue mode
- Basic answer timer (visible, no cutoff)
- Host controller: open buzzers, accept/reject answers, manual score edit
- Big screen: board grid, question overlay, podiums with scores
- Player view: buzzer button, locked state, score
- Game persistence (save/resume — Supabase is already the source of truth)
- Lobby, room code via `jp_rooms`, find-room entry, and JoinPage flow

**Defer to later passes:**
- Audio, video, and reveal image blocks
- Multiple choice, closest number, ranking answer modes
- Power-up system and dangerous tiles (Sniper offset in the resolve RPC can land with this pass; the collection-window plumbing is MVP)
- Two-board support
- Final Jeopardy
- Buzzer sounds (`apps/account` UI + playback)
- Post-game stats screen (but write `jp_game_events` rows from day one)
- Team mode (build for individual players first — model each solo player as a one-member team so the schema doesn't change later)
- Typewriter and animated reveal display modes
- Full Question Builder polish (drag reorder, side panel, preview modal)

The MVP should feel like a complete, playable Jeopardy game. Add the chaos layer on top.
