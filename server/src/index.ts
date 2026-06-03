import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { calculateArtistBonus, calculateGuesserScore, isCorrectGuess } from "../../shared/src/scoring";
import { createArtistOrder, maskWord, selectNextArtistFromOrder, shouldEndGame, shouldEndRound } from "../../shared/src/roundLogic";
import { DEFAULT_SETTINGS, type CanvasPatch, type ChatMessage, type ClientEvent, type Player, type PublicRoomState, type RoomSettings, type ServerEvent } from "../../shared/src/types";
import { pickWordChoices } from "../../shared/src/wordList";

type Client = {
  socket: WebSocket;
  playerId: string;
  roomCode: string;
};

type Room = {
  code: string;
  hostId: string;
  phase: PublicRoomState["phase"];
  settings: RoomSettings;
  players: Player[];
  artistOrder: string[];
  artistOrderIndex: number;
  artistId: string | null;
  round: number;
  answer: string | null;
  wordChoices: string[];
  canvas: (string | null)[][];
  chat: ChatMessage[];
  guessedPlayerIds: Set<string>;
  roundStartedAt: number;
  remainingSeconds: number;
  timer: NodeJS.Timeout | null;
  replay: CanvasPatch[];
};

const PORT = Number(process.env.PORT ?? 3001);
const server = createServer();
const wss = new WebSocketServer({ server });
const rooms = new Map<string, Room>();
const clients = new Map<WebSocket, Client>();

function createCanvas(size: number): (string | null)[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function createRoomCode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function broadcast(room: Room, event: ServerEvent): void {
  for (const [socket, client] of clients.entries()) {
    if (client.roomCode === room.code) send(socket, event);
  }
}

function getClient(socket: WebSocket): Client | null {
  return clients.get(socket) ?? null;
}

function getRoomForSocket(socket: WebSocket): Room | null {
  const client = getClient(socket);
  if (!client) return null;
  return rooms.get(client.roomCode) ?? null;
}

function remainingSeconds(room: Room): number {
  if (room.phase !== "drawing") return room.remainingSeconds;
  const elapsed = Math.floor((Date.now() - room.roundStartedAt) / 1000);
  return Math.max(0, room.settings.roundSeconds - elapsed);
}

function publicState(room: Room, viewerId?: string): PublicRoomState {
  const isArtist = viewerId === room.artistId;
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    players: room.players,
    artistId: room.artistId,
    round: room.round,
    wordProgress: room.answer ? maskWord(room.answer, Boolean(isArtist) || room.phase === "round-results" || room.phase === "game-over") : "",
    answer: room.phase === "round-results" || room.phase === "game-over" || isArtist ? room.answer ?? undefined : undefined,
    canvas: room.canvas,
    chat: room.chat.slice(-50),
    remainingSeconds: remainingSeconds(room),
    wordChoices: isArtist && room.phase === "choosing-word" ? room.wordChoices : undefined,
    guessedPlayerIds: [...room.guessedPlayerIds]
  };
}

function sendState(room: Room): void {
  for (const [socket, client] of clients.entries()) {
    if (client.roomCode === room.code) send(socket, { type: "room_state", state: publicState(room, client.playerId) });
  }
}

function addSystemMessage(room: Room, text: string): void {
  const message: ChatMessage = {
    id: randomUUID(),
    playerId: null,
    playerName: "System",
    text,
    kind: "system",
    createdAt: Date.now()
  };
  room.chat.push(message);
  broadcast(room, { type: "chat_message", message });
}

function applyPatch(room: Room, patch: CanvasPatch): void {
  for (const pixel of patch.after) {
    if (room.canvas[pixel.y]?.[pixel.x] !== undefined) {
      room.canvas[pixel.y][pixel.x] = pixel.color;
    }
  }
  room.replay.push(patch);
}

function stopTimer(room: Room): void {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

function startTimer(room: Room): void {
  stopTimer(room);
  room.roundStartedAt = Date.now();
  room.remainingSeconds = room.settings.roundSeconds;
  room.timer = setInterval(() => {
    room.remainingSeconds = remainingSeconds(room);
    broadcast(room, { type: "timer_tick", remainingSeconds: room.remainingSeconds });
    if (room.remainingSeconds <= 0) endRound(room);
  }, 1000);
}

function beginChoosing(room: Room): void {
  stopTimer(room);
  room.phase = "choosing-word";
  room.answer = null;
  room.wordChoices = pickWordChoices();
  room.canvas = createCanvas(room.settings.gridSize);
  room.guessedPlayerIds = new Set();
  room.replay = [];
  const nextArtist = selectNextArtistFromOrder(room.players, room.artistOrder, room.artistOrderIndex);
  room.artistId = nextArtist?.artistId ?? null;
  room.artistOrderIndex = nextArtist?.orderIndex ?? room.artistOrderIndex;
  if (!room.artistId) {
    room.phase = "lobby";
    addSystemMessage(room, "Need at least one connected player to draw.");
    sendState(room);
    return;
  }
  addSystemMessage(room, `${room.players.find((player) => player.id === room.artistId)?.name ?? "Someone"} is choosing a word.`);
  sendState(room);
}

function beginDrawing(room: Room, word: string): void {
  room.answer = word;
  room.phase = "drawing";
  room.remainingSeconds = room.settings.roundSeconds;
  addSystemMessage(room, "The round has started.");
  startTimer(room);
  sendState(room);
}

function endRound(room: Room): void {
  if (room.phase !== "drawing") return;
  stopTimer(room);
  room.phase = "round-results";
  room.remainingSeconds = 0;
  const answer = room.answer ?? "";
  addSystemMessage(room, `The answer was "${answer}".`);
  broadcast(room, { type: "round_ended", answer, state: publicState(room) });
  setTimeout(() => {
    room.round += 1;
    if (shouldEndGame(room.round - 1, room.settings.rounds)) {
      room.phase = "game-over";
      broadcast(room, { type: "game_over", state: publicState(room) });
      sendState(room);
    } else {
      beginChoosing(room);
    }
  }, 4000);
}

function makePlayer(name: string, clientId: string, spectator = false): Player {
  return {
    id: randomUUID(),
    clientId,
    name: name.trim().slice(0, 24) || "Player",
    score: 0,
    connected: true,
    isSpectator: spectator
  };
}

function joinSocket(socket: WebSocket, room: Room, player: Player): void {
  clients.set(socket, { socket, playerId: player.id, roomCode: room.code });
  send(socket, { type: "room_joined", playerId: player.id, state: publicState(room, player.id) });
  sendState(room);
}

function handleCreateRoom(socket: WebSocket, event: Extract<ClientEvent, { type: "create_room" }>): void {
  const code = createRoomCode();
  const player = makePlayer(event.name, event.clientId);
  const room: Room = {
    code,
    hostId: player.id,
    phase: "lobby",
    settings: { ...DEFAULT_SETTINGS },
    players: [player],
    artistOrder: [],
    artistOrderIndex: -1,
    artistId: null,
    round: 1,
    answer: null,
    wordChoices: [],
    canvas: createCanvas(DEFAULT_SETTINGS.gridSize),
    chat: [],
    guessedPlayerIds: new Set(),
    roundStartedAt: 0,
    remainingSeconds: DEFAULT_SETTINGS.roundSeconds,
    timer: null,
    replay: []
  };
  rooms.set(code, room);
  clients.set(socket, { socket, playerId: player.id, roomCode: code });
  send(socket, { type: "room_created", roomCode: code, playerId: player.id, state: publicState(room, player.id) });
}

function handleJoinRoom(socket: WebSocket, event: Extract<ClientEvent, { type: "join_room" }>): void {
  const room = rooms.get(event.roomCode.toUpperCase());
  if (!room) return send(socket, { type: "error", message: "Room not found." });
  const existing = room.players.find((player) => player.clientId === event.clientId);
  if (existing) {
    existing.connected = true;
    return joinSocket(socket, room, existing);
  }
  const activePlayers = room.players.filter((player) => !player.isSpectator).length;
  const spectator = Boolean(event.spectator) || activePlayers >= room.settings.maxPlayers;
  if (spectator && !room.settings.allowSpectators) return send(socket, { type: "error", message: "This room is full." });
  const player = makePlayer(event.name, event.clientId, spectator);
  room.players.push(player);
  addSystemMessage(room, `${player.name} joined${spectator ? " as a spectator" : ""}.`);
  joinSocket(socket, room, player);
}

function handleMessage(socket: WebSocket, event: ClientEvent): void {
  if (event.type === "create_room") return handleCreateRoom(socket, event);
  if (event.type === "join_room") return handleJoinRoom(socket, event);
  if (event.type === "rejoin_room") {
    const room = rooms.get(event.roomCode.toUpperCase());
    const player = room?.players.find((candidate) => candidate.clientId === event.clientId);
    if (!room || !player) return send(socket, { type: "error", message: "Could not rejoin that room." });
    player.connected = true;
    return joinSocket(socket, room, player);
  }

  const room = getRoomForSocket(socket);
  const client = getClient(socket);
  const player = room?.players.find((candidate) => candidate.id === client?.playerId);
  if (!room || !client || !player) return send(socket, { type: "error", message: "Join a room first." });

  if (event.type === "update_settings") {
    if (player.id !== room.hostId || room.phase !== "lobby") return;
    room.settings = { ...room.settings, ...event.settings };
    room.settings.gridSize = Math.max(8, Math.min(64, Math.round(room.settings.gridSize)));
    room.settings.rounds = Math.max(1, Math.min(10, Math.round(room.settings.rounds)));
    room.settings.roundSeconds = Math.max(20, Math.min(180, Math.round(room.settings.roundSeconds)));
    room.settings.maxPlayers = Math.max(2, Math.min(8, Math.round(room.settings.maxPlayers)));
    room.canvas = createCanvas(room.settings.gridSize);
    return sendState(room);
  }

  if (event.type === "start_game") {
    if (player.id !== room.hostId || room.phase !== "lobby") return;
    room.round = 1;
    room.artistOrder = createArtistOrder(room.players);
    room.artistOrderIndex = -1;
    room.players.forEach((roomPlayer) => {
      roomPlayer.score = 0;
    });
    return beginChoosing(room);
  }

  if (event.type === "choose_word") {
    if (player.id !== room.artistId || room.phase !== "choosing-word" || !room.wordChoices.includes(event.word)) return;
    return beginDrawing(room, event.word);
  }

  if (event.type === "draw_patch") {
    if (player.id !== room.artistId || room.phase !== "drawing") return;
    applyPatch(room, event.patch);
    return broadcast(room, { type: "canvas_patch", patch: event.patch });
  }

  if (event.type === "submit_guess") {
    const text = event.text.trim().slice(0, 120);
    if (!text) return;
    const message: ChatMessage = {
      id: randomUUID(),
      playerId: player.id,
      playerName: player.name,
      text,
      kind: "chat",
      createdAt: Date.now()
    };
    if (room.phase === "drawing" && player.id !== room.artistId && !player.isSpectator && room.answer && isCorrectGuess(text, room.answer)) {
      if (!room.guessedPlayerIds.has(player.id)) {
        room.guessedPlayerIds.add(player.id);
        player.score += calculateGuesserScore(remainingSeconds(room), room.settings.roundSeconds);
        const artist = room.players.find((candidate) => candidate.id === room.artistId);
        if (artist) artist.score += calculateArtistBonus(1);
        message.kind = "correct";
        message.text = "guessed correctly!";
        broadcast(room, { type: "score_update", players: room.players });
        if (shouldEndRound(room.players, room.artistId, room.guessedPlayerIds)) setTimeout(() => endRound(room), 500);
      }
    }
    room.chat.push(message);
    broadcast(room, { type: "chat_message", message });
    return sendState(room);
  }
}

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    try {
      handleMessage(socket, JSON.parse(raw.toString()) as ClientEvent);
    } catch {
      send(socket, { type: "error", message: "Invalid message." });
    }
  });

  socket.on("close", () => {
    const client = clients.get(socket);
    clients.delete(socket);
    if (!client) return;
    const room = rooms.get(client.roomCode);
    const player = room?.players.find((candidate) => candidate.id === client.playerId);
    if (!room || !player) return;
    const hasReplacementSocket = [...clients.values()].some(
      (candidate) => candidate.roomCode === client.roomCode && candidate.playerId === client.playerId
    );
    if (hasReplacementSocket) return;
    player.connected = false;
    addSystemMessage(room, `${player.name} disconnected.`);
    sendState(room);
  });
});

server.listen(PORT, () => {
  console.log(`Pixel Guess server listening on ws://localhost:${PORT}`);
});
