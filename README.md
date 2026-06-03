# Pixel Guess

A local browser-based multiplayer drawing-and-guessing game inspired by Skribbl.io, but with a pixel-art canvas instead of freehand drawing.

## Features

- TypeScript across client, server, and shared game logic
- React frontend with a retro pixel-art interface
- Node.js WebSocket backend using `ws`
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
http://localhost:5173
```

The WebSocket server runs at:

```text
ws://localhost:3001
```

## Scripts

```bash
npm run dev        # start client and server
npm run test       # run Vitest tests
npm run typecheck  # run TypeScript checks
npm run build      # build the React client and typecheck the project
```

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
client/   React UI, WebSocket client, pixel drawing board
server/   Node.js WebSocket server, rooms, timers, authoritative game state
shared/   Shared TypeScript types, scoring, round logic, sample word list
tests/    Vitest coverage for core game logic
```

The server is authoritative for scoring, guesses, timers, room membership, and canvas state. The client sends user actions, renders state, and applies canvas patches broadcast by the server.

## Notes

The current implementation supports at least 8 active players per room, plus spectators when enabled. Canvas updates are sent as patches, and the server keeps the full canvas state so reconnecting players and late joiners receive the current drawing immediately.

For local testing, open multiple tabs or windows. Each tab gets its own player session, while a refresh in that same tab rejoins the same player and room.
