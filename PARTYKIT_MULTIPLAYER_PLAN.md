# PartyKit Multiplayer Plan

## Goal

Host the React client as a static GitHub Pages site while moving the authoritative multiplayer backend from the local Node `ws` server to PartyKit. The game should keep the existing room-code flow, reconnect behavior, pixel patch syncing, scoring, timers, spectator support, and free-draw mode.

## Current State

- `client/` is a Vite React app. It connects to `ws://${window.location.hostname}:3001`, which only works with the local Node server.
- `server/src/index.ts` owns authoritative room state with `ws`, `Map`-based rooms, timers, and connection tracking.
- `shared/` already contains portable game types and pure logic for scoring, round flow, and word selection.
- Tests cover `shared` scoring and round logic, but the websocket server behavior is not directly covered.

## Target Architecture

```text
GitHub Pages
  static Vite build
  connects with PartySocket/WebSocket
        |
        v
PartyKit project
  one PartyKit room per Pixel Guess room code
  authoritative state, scoring, timers, canvas patches
        |
        v
PartyKit room storage
  optional room snapshots for hibernation/restart recovery
```

Use PartyKit for realtime infrastructure and keep GitHub Pages strictly static. PartyKit's docs describe a `Party.Server` class with `onConnect`, `onMessage`, `onClose`, room-scoped storage, and `room.broadcast`, which maps closely to the existing `ws` server. PartySocket is compatible with the browser WebSocket API and adds automatic reconnecting.

## Recommended Room Model

Use the PartyKit room id as the public four-letter room code:

- `create_room` and `create_free_draw` connect to a newly generated PartyKit room id.
- `join_room` and `rejoin_room` connect directly to the existing room id.
- Each PartyKit room contains exactly one game room. This removes the existing global `rooms` map and lets PartyKit route all messages for a room to the same server instance.

This requires one small product-flow change: room creation needs a room code before opening the game socket. The cleanest approach is to add a lightweight PartyKit `onFetch` endpoint, such as `POST /api/rooms`, that returns an unused code. The client then opens a PartySocket to that code and sends `create_room`.

Alternative: generate room codes on the client. This is simpler, but the server would still need collision handling, so the HTTP endpoint is the better long-term path.

## Implementation Phases

### 1. Add PartyKit Dependencies and Config

- Add runtime dependencies:
  - `partykit`
  - `partysocket`
- Add `partykit.json` with:
  - `name`: final PartyKit project name, for example `pixel-guess`
  - `main`: `party/src/index.ts`
  - `port`: `1999` for local development
- Add scripts:
  - `dev:party`: `partykit dev`
  - `deploy:party`: `partykit deploy`
  - Update `dev` to run Vite plus PartyKit instead of the Node `ws` server once the port is complete.
- Keep `server/src/index.ts` temporarily as a reference until feature parity is verified.

### 2. Port the Server to a PartyKit Room

Create `party/src/index.ts` and port the existing server behavior into a `Party.Server` class:

- Replace `WebSocket` with `Party.Connection`.
- Replace `clients: Map<WebSocket, Client>` with connection state:
  - `connection.setState({ playerId, roomCode })`
  - `connection.state` for lookups
- Replace `broadcast(room, event)` with `this.room.broadcast(JSON.stringify(event))`.
- Replace `send(socket, event)` with `connection.send(JSON.stringify(event))`.
- Replace the top-level `rooms` map with a single `this.state` room object per PartyKit room.
- Convert `randomUUID` import to `crypto.randomUUID()` so it runs in the edge runtime.
- Preserve existing validation rules for host-only settings, artist-only drawing, word selection, guessing, spectators, and free-draw clearing.

Suggested split while porting:

- Move reusable server room operations into `party/src/roomState.ts` if `index.ts` gets too large.
- Keep the event contract in `shared/src/types.ts` unchanged during the first port.
- Add narrow tests around a pure reducer/helper layer if server logic is extracted.

### 3. Handle Timers with Alarms or a Live Interval

The current server uses `setInterval` for drawing-round ticks and `setTimeout` for round transitions. In PartyKit, there are two viable approaches:

- First pass: keep in-memory timers while a room has active connections. This is easiest and probably fine for short live games.
- Durable pass: store `roundStartedAt`, `phase`, and pending transition data, then use PartyKit alarms for wakeups and recovery after hibernation or isolate restart.

Recommended rollout:

1. Port with in-memory timers and explicitly disable hibernation at first.
2. After parity, add storage snapshots and alarms for robust resume.
3. Consider `options = { hibernate: true }` only after timer and connection-state recovery are tested.

### 4. Persist Room Snapshots

Store a compact snapshot after state-changing events:

- `room`: serializable room state
- `guessedPlayerIds`: array instead of `Set`
- `updatedAt`: timestamp
- `expiresAt`: timestamp for cleanup decisions

Do not store transient connections or timer handles. Rebuild those from PartyKit connections and room phase when the server starts.

Important storage detail: PartyKit room storage values have a per-value size limit, so keep canvas state compact. A 64x64 grid as nested arrays is likely okay, but if larger canvases or long replay histories become a goal, store canvas separately from chat and trim replay aggressively.

### 5. Update the Client Connection Layer

Replace the fixed local websocket URL in `client/src/main.tsx` with an environment-aware PartyKit connection module.

Recommended client env variables:

- `VITE_PARTYKIT_HOST`
  - local: `localhost:1999`
  - production: `<project>.<github-user>.partykit.dev`
- `VITE_PARTYKIT_PROTOCOL`
  - optional; default to `ws` on localhost and `wss` otherwise if using native `WebSocket`

Prefer `partysocket`:

- It accepts `{ host, room }`.
- It is browser WebSocket API compatible.
- It reconnects automatically, which should improve the current refresh/rejoin story.

Client flow changes:

- On entry screen, do not open a room websocket immediately.
- `Create room` calls the PartyKit room-code endpoint, then connects to that room and sends `create_room`.
- `Join` connects to the typed room code and sends `join_room`.
- `rejoin_room` reads the saved room code, connects to that room, and sends the existing event.
- Keep `clientId` in `sessionStorage` as-is.

### 6. GitHub Pages Deployment

Configure Vite for GitHub Pages:

- Set `base` in `client/vite.config.ts` to the repository pages path, usually `/pixel-guess/`, or derive it from an env var.
- Build output can stay `dist/client`.
- Add a GitHub Actions workflow for Pages:
  - checkout
  - setup Node
  - `npm ci`
  - `npm run test`
  - `npm run build`
  - upload `dist/client`
  - deploy to Pages
- Add `VITE_PARTYKIT_HOST` as a non-secret repository variable or hard-code the public PartyKit host in the Pages workflow.

PartyKit deploy can be manual at first with `npx partykit deploy`. For CI/CD, generate a PartyKit token locally and store `PARTYKIT_LOGIN` and `PARTYKIT_TOKEN` as GitHub Actions secrets. PartyKit's CI docs warn that the token can deploy on your behalf, so it should never be committed.

### 7. Local Development Workflow

Target workflow:

```bash
npm run dev
```

Expected local services:

- Vite client: `http://localhost:5173`
- PartyKit server: `http://localhost:1999`

Useful checks:

- Open two browser tabs with different `sessionStorage` sessions.
- Create a room in one tab.
- Join with the room code in another tab.
- Verify lobby settings, start game, word choice visibility, draw patch sync, guesses, scoring, reconnect, spectators, free draw, undo/redo, and PNG save.

### 8. Testing Plan

Keep existing tests:

- `tests/scoring.test.ts`
- `tests/roundLogic.test.ts`

Add server behavior tests where practical:

- Room creation initializes expected state.
- Joining with same `clientId` reconnects the same player.
- Full-room join becomes spectator when spectators are allowed.
- Host-only settings are ignored for non-hosts.
- Only artist can draw.
- Correct guess updates guesser and artist scores.
- Round ends when all eligible guessers have guessed.

Add at least one browser-level smoke test before release:

- Build and serve the client.
- Run PartyKit locally.
- Drive two tabs through create, join, draw, guess, and reconnect.

### 9. Risks and Decisions

- **Room code creation:** needs an authoritative collision-free path. Use a PartyKit HTTP endpoint rather than client-only code generation.
- **Timers and hibernation:** start without hibernation, then add alarms/storage recovery once parity is solid.
- **Storage shape:** avoid storing non-serializable data like `Set` and timer handles.
- **Node-only APIs:** replace `node:http`, `ws`, and `node:crypto` usage in the PartyKit path.
- **GitHub Pages base path:** must be correct or the built app will load blank assets.
- **CORS/origin policy:** if needed, add `onBeforeConnect` validation to allow local dev and the GitHub Pages origin.
- **Free tier persistence:** confirm expected PartyKit storage retention for the chosen deployment mode before relying on rooms surviving long idle periods.

## Acceptance Criteria

- The app can be opened from GitHub Pages.
- Creating a room produces a shareable code.
- A second browser/device can join that code through PartyKit.
- Drawing patches sync live.
- Guessing, scoring, timers, round transitions, and game-over behavior match the current local server.
- Refreshing a tab rejoins the same player when `sessionStorage` still has the room and client id.
- Local development works with Vite plus PartyKit.
- `npm run test`, `npm run typecheck`, and `npm run build` pass.

## References

- PartyKit docs: https://docs.partykit.io/
- Party.Server API: https://docs.partykit.io/reference/partyserver-api/
- PartySocket API: https://docs.partykit.io/reference/partysocket-api/
- PartyKit configuration: https://docs.partykit.io/reference/partykit-configuration/
- PartyKit deployment: https://docs.partykit.io/guides/deploying-your-partykit-server/
- PartyKit GitHub Actions: https://docs.partykit.io/guides/setting-up-ci-cd-with-github-actions/
