# Pixel Guess

A browser-based multiplayer drawing-and-guessing game inspired by Skribbl.io, but with a pixel-art canvas instead of freehand drawing.

## Features

- TypeScript across client, server, and shared game logic
- React frontend with a retro pixel-art interface
- PartyKit WebSocket backend for hosted multiplayer rooms
- Create and join rooms with short room codes
- Artist rotation, 3 word choices, round timer, answer reveal, and final rankings
- 32x32 default pixel grid with configurable room setting
- 16-color palette, eraser, bucket fill, hover preview, undo, redo, and PNG export
- Network-efficient canvas sync using pixel patches instead of full canvas broadcasts
- Late join/reconnect support through a per-tab browser session id
- Tests for scoring and round-management logic

## Requirements

- Node.js 20 or newer
- npm

## Setup

```bash
npm install
npm run dev
```

Open the client at:

```text
http://localhost:5173/pixel-guess/
```

The PartyKit server runs at:

```text
http://localhost:1999
```

## Scripts

```bash
npm run dev          # start Vite and PartyKit locally
npm run dev:client   # start only the Vite client
npm run dev:party    # start only the PartyKit backend
npm run test         # run Vitest tests
npm run typecheck    # run TypeScript checks
npm run build        # build the React client and typecheck the project
npm run deploy:party # deploy the PartyKit backend
```

## Deployment

The frontend is a static Vite build that can run on GitHub Pages. The backend runs separately on PartyKit.

### Manual PartyKit setup

1. Install dependencies locally:

   ```bash
   npm install
   ```

2. Log in to PartyKit and deploy the backend:

   ```bash
   npm run deploy:party
   ```

3. Copy the PartyKit host from the deploy output. It should look like:

   ```text
   pixel-guess.<your-github-username>.partykit.dev
   ```

4. In the GitHub repository, go to **Settings -> Secrets and variables -> Actions -> Variables**.

5. Add a repository variable:

   ```text
   VITE_PARTYKIT_HOST=pixel-guess.<your-github-username>.partykit.dev
   ```

6. If you use a custom domain instead of `*.github.io`, allow it in PartyKit:

   ```bash
   npx partykit deploy --var PUBLIC_ALLOWED_ORIGINS:https://your-custom-domain.example
   ```

   GitHub Pages origins ending in `.github.io`, plus local development origins, are allowed by default.

7. Go to **Settings -> Pages**.

8. Set **Build and deployment** to **GitHub Actions**.

9. Run the **Deploy GitHub Pages** workflow, or push to `main`.

### Optional PartyKit deploy workflow

The repository includes a manual **Deploy PartyKit** workflow. To use it:

1. Generate a PartyKit token locally:

   ```bash
   npx partykit@latest token generate
   ```

2. Copy the generated values.

3. In the GitHub repository, go to **Settings -> Secrets and variables -> Actions -> Secrets**.

4. Add these repository secrets:

   ```text
   PARTYKIT_LOGIN=<generated login>
   PARTYKIT_TOKEN=<generated token>
   ```

5. Run the **Deploy PartyKit** workflow from the GitHub Actions tab.

Do not commit `PARTYKIT_LOGIN` or `PARTYKIT_TOKEN`.

## Gameplay

1. Create a room or join one with a room code.
2. The host starts the game from the lobby.
3. Each round selects one artist.
4. The artist chooses one of three words.
5. The artist draws on the pixel grid.
6. Other players guess through chat.
7. Correct guesses score more points when submitted earlier.
8. The artist earns bonus points for each correct guess.
9. The answer is revealed when time expires or all guessers are correct.
10. Final rankings are shown after the configured number of rounds.

## Architecture

```text
client/   React UI, PartySocket client, pixel drawing board
party/    PartyKit server, rooms, timers, authoritative game state
server/   Legacy local Node.js WebSocket server kept as a reference
shared/   Shared TypeScript types, scoring, round logic, sample word list
tests/    Vitest coverage for core game logic
```

The server is authoritative for scoring, guesses, timers, room membership, and canvas state. The client sends user actions, renders state, and applies canvas patches broadcast by the server.

## Notes

The current implementation supports at least 8 active players per room, plus spectators when enabled. Canvas updates are sent as patches, and the server keeps the full canvas state so reconnecting players and late joiners receive the current drawing immediately.

For local testing, open multiple tabs or windows. Each tab gets its own player session, while a refresh in that same tab rejoins the same player and room.
