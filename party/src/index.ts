import type * as Party from "partykit/server";
import { calculateArtistBonus, calculateGuesserScore, isCorrectGuess } from "../../shared/src/scoring";
import { createArtistOrder, maskWord, selectNextArtistFromOrder, shouldEndGame, shouldEndRound } from "../../shared/src/roundLogic";
import {
  DEFAULT_SETTINGS,
  type CanvasPatch,
  type ChatMessage,
  type ClientEvent,
  type Player,
  type PublicRoomState,
  type RoomSettings,
  type ServerEvent
} from "../../shared/src/types";
import { pickWordChoices } from "../../shared/src/wordList";

type ClientState = {
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
  replay: CanvasPatch[];
};

type StoredRoom = Omit<Room, "guessedPlayerIds"> & {
  guessedPlayerIds: string[];
  updatedAt: number;
};

const STORAGE_KEY = "room";
const ROUND_RESULTS_DELAY_MS = 4000;
const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

function createCanvas(size: number): (string | null)[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function createRoomCode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function roomFromStored(stored: StoredRoom): Room {
  return {
    ...stored,
    guessedPlayerIds: new Set(stored.guessedPlayerIds)
  };
}

function roomToStored(room: Room): StoredRoom {
  return {
    ...room,
    guessedPlayerIds: [...room.guessedPlayerIds],
    updatedAt: Date.now()
  };
}

function connectionState(connection: Party.Connection): ClientState | null {
  const state = connection.state as Partial<ClientState> | undefined;
  if (!state?.playerId || !state.roomCode) return null;
  return { playerId: state.playerId, roomCode: state.roomCode };
}

function send(connection: Party.Connection, event: ServerEvent): void {
  connection.send(JSON.stringify(event));
}

export default class Server implements Party.Server {
  readonly options = { hibernate: false };
  private state: Room | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private roundTransition: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly room: Party.Room) {}

  static async onFetch(req: Party.Request) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS" && url.pathname === "/api/rooms") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      return Response.json({ roomCode: createRoomCode() }, { headers: CORS_HEADERS });
    }

    return new Response("Not found", { headers: CORS_HEADERS, status: 404 });
  }

  async onStart() {
    const stored = await this.room.storage.get<StoredRoom>(STORAGE_KEY);
    if (!stored) return;
    this.state = roomFromStored(stored);
    this.resumeTimer();
  }

  async onMessage(raw: string | ArrayBuffer, connection: Party.Connection) {
    try {
      const message = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      await this.handleMessage(connection, JSON.parse(message) as ClientEvent);
    } catch {
      send(connection, { type: "error", message: "Invalid message." });
    }
  }

  async onClose(connection: Party.Connection) {
    await this.disconnect(connection);
  }

  async onError(connection: Party.Connection) {
    await this.disconnect(connection);
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await this.room.storage.put(STORAGE_KEY, roomToStored(this.state));
  }

  private broadcast(event: ServerEvent): void {
    this.room.broadcast(JSON.stringify(event));
  }

  private remainingSeconds(room = this.state): number {
    if (!room) return 0;
    if (room.phase !== "drawing") return room.remainingSeconds;
    const elapsed = Math.floor((Date.now() - room.roundStartedAt) / 1000);
    return Math.max(0, room.settings.roundSeconds - elapsed);
  }

  private publicState(room: Room, viewerId?: string): PublicRoomState {
    const isArtist = viewerId === room.artistId;
    const shouldRevealAnswer = room.phase === "round-results" || room.phase === "game-over" || isArtist;
    return {
      code: room.code,
      hostId: room.hostId,
      phase: room.phase,
      settings: room.settings,
      players: room.players,
      artistId: room.artistId,
      round: room.round,
      wordProgress: room.answer ? maskWord(room.answer, shouldRevealAnswer) : "",
      answer: shouldRevealAnswer ? room.answer ?? undefined : undefined,
      canvas: room.canvas,
      chat: room.chat.slice(-50),
      remainingSeconds: this.remainingSeconds(room),
      wordChoices: isArtist && room.phase === "choosing-word" ? room.wordChoices : undefined,
      guessedPlayerIds: [...room.guessedPlayerIds]
    };
  }

  private sendState(room = this.state): void {
    if (!room) return;
    for (const connection of this.room.getConnections()) {
      const client = connectionState(connection);
      if (client?.roomCode === room.code) {
        send(connection, { type: "room_state", state: this.publicState(room, client.playerId) });
      }
    }
  }

  private async addSystemMessage(room: Room, text: string): Promise<void> {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      playerId: null,
      playerName: "System",
      text,
      kind: "system",
      createdAt: Date.now()
    };
    room.chat.push(message);
    this.broadcast({ type: "chat_message", message });
    await this.persist();
  }

  private applyPatch(room: Room, patch: CanvasPatch): void {
    for (const pixel of patch.after) {
      if (room.canvas[pixel.y]?.[pixel.x] !== undefined) {
        room.canvas[pixel.y][pixel.x] = pixel.color;
      }
    }
    room.replay.push(patch);
  }

  private clearCanvas(room: Room): void {
    room.canvas = createCanvas(room.settings.gridSize);
    room.replay = [];
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.roundTransition) clearTimeout(this.roundTransition);
    this.timer = null;
    this.roundTransition = null;
  }

  private startTimer(room: Room): void {
    this.stopTimer();
    room.roundStartedAt = Date.now();
    room.remainingSeconds = room.settings.roundSeconds;
    this.timer = setInterval(() => {
      void this.tickTimer();
    }, 1000);
  }

  private resumeTimer(): void {
    if (!this.state || this.state.phase !== "drawing") return;
    this.timer = setInterval(() => {
      void this.tickTimer();
    }, 1000);
  }

  private async tickTimer(): Promise<void> {
    if (!this.state || this.state.phase !== "drawing") return;
    this.state.remainingSeconds = this.remainingSeconds(this.state);
    this.broadcast({ type: "timer_tick", remainingSeconds: this.state.remainingSeconds });
    if (this.state.remainingSeconds <= 0) await this.endRound(this.state);
  }

  private async beginChoosing(room: Room): Promise<void> {
    this.stopTimer();
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
      await this.addSystemMessage(room, "Need at least one connected player to draw.");
      this.sendState(room);
      return;
    }
    await this.addSystemMessage(room, `${room.players.find((player) => player.id === room.artistId)?.name ?? "Someone"} is choosing a word.`);
    this.sendState(room);
    await this.persist();
  }

  private async beginDrawing(room: Room, word: string): Promise<void> {
    room.answer = word;
    room.phase = "drawing";
    room.remainingSeconds = room.settings.roundSeconds;
    await this.addSystemMessage(room, "The round has started.");
    this.startTimer(room);
    this.sendState(room);
    await this.persist();
  }

  private async endRound(room: Room): Promise<void> {
    if (room.phase !== "drawing") return;
    this.stopTimer();
    room.phase = "round-results";
    room.remainingSeconds = 0;
    const answer = room.answer ?? "";
    await this.addSystemMessage(room, `The answer was "${answer}".`);
    this.broadcast({ type: "round_ended", answer, state: this.publicState(room) });
    await this.persist();
    this.roundTransition = setTimeout(() => {
      void this.afterRoundResults(room);
    }, ROUND_RESULTS_DELAY_MS);
  }

  private async afterRoundResults(room: Room): Promise<void> {
    room.round += 1;
    if (shouldEndGame(room.round - 1, room.settings.rounds)) {
      room.phase = "game-over";
      this.broadcast({ type: "game_over", state: this.publicState(room) });
      this.sendState(room);
      await this.persist();
    } else {
      await this.beginChoosing(room);
    }
  }

  private makePlayer(name: string, clientId: string, spectator = false): Player {
    return {
      id: crypto.randomUUID(),
      clientId,
      name: name.trim().slice(0, 24) || "Player",
      score: 0,
      connected: true,
      isSpectator: spectator
    };
  }

  private joinConnection(connection: Party.Connection, room: Room, player: Player): void {
    connection.setState({ playerId: player.id, roomCode: room.code } satisfies ClientState);
    send(connection, { type: "room_joined", playerId: player.id, state: this.publicState(room, player.id) });
    this.sendState(room);
  }

  private async createRoom(
    connection: Party.Connection,
    event: Extract<ClientEvent, { type: "create_room" | "create_free_draw" }>,
    phase: Room["phase"]
  ): Promise<void> {
    if (this.state) {
      send(connection, { type: "error", message: "Room already exists." });
      return;
    }

    const code = this.room.id.toUpperCase();
    const player = this.makePlayer(event.name, event.clientId);
    const room: Room = {
      code,
      hostId: player.id,
      phase,
      settings: { ...DEFAULT_SETTINGS },
      players: [player],
      artistOrder: [],
      artistOrderIndex: -1,
      artistId: phase === "free-draw" ? player.id : null,
      round: 1,
      answer: null,
      wordChoices: [],
      canvas: createCanvas(DEFAULT_SETTINGS.gridSize),
      chat: [],
      guessedPlayerIds: new Set(),
      roundStartedAt: 0,
      remainingSeconds: phase === "free-draw" ? 0 : DEFAULT_SETTINGS.roundSeconds,
      replay: []
    };
    this.state = room;
    connection.setState({ playerId: player.id, roomCode: code } satisfies ClientState);
    if (phase === "free-draw") {
      await this.addSystemMessage(room, `${player.name} started a free draw.`);
    }
    send(connection, { type: "room_created", roomCode: code, playerId: player.id, state: this.publicState(room, player.id) });
    await this.persist();
  }

  private async handleJoinRoom(connection: Party.Connection, event: Extract<ClientEvent, { type: "join_room" }>): Promise<void> {
    const room = this.state;
    if (!room || room.code !== event.roomCode.toUpperCase()) {
      send(connection, { type: "error", message: "Room not found." });
      return;
    }

    const existing = room.players.find((player) => player.clientId === event.clientId);
    if (existing) {
      existing.connected = true;
      this.joinConnection(connection, room, existing);
      await this.persist();
      return;
    }

    const activePlayers = room.players.filter((player) => !player.isSpectator).length;
    const spectator = Boolean(event.spectator) || activePlayers >= room.settings.maxPlayers;
    if (spectator && !room.settings.allowSpectators) {
      send(connection, { type: "error", message: "This room is full." });
      return;
    }

    const player = this.makePlayer(event.name, event.clientId, spectator);
    room.players.push(player);
    await this.addSystemMessage(room, `${player.name} joined${spectator ? " as a spectator" : ""}.`);
    this.joinConnection(connection, room, player);
    await this.persist();
  }

  private async handleMessage(connection: Party.Connection, event: ClientEvent): Promise<void> {
    if (event.type === "create_room") return this.createRoom(connection, event, "lobby");
    if (event.type === "create_free_draw") return this.createRoom(connection, event, "free-draw");
    if (event.type === "join_room") return this.handleJoinRoom(connection, event);
    if (event.type === "rejoin_room") {
      const room = this.state;
      const player = room?.players.find((candidate) => candidate.clientId === event.clientId);
      if (!room || room.code !== event.roomCode.toUpperCase() || !player) {
        send(connection, { type: "error", message: "Could not rejoin that room." });
        return;
      }
      player.connected = true;
      this.joinConnection(connection, room, player);
      await this.persist();
      return;
    }

    const room = this.state;
    const client = connectionState(connection);
    const player = room?.players.find((candidate) => candidate.id === client?.playerId);
    if (!room || !client || !player) {
      send(connection, { type: "error", message: "Join a room first." });
      return;
    }

    if (event.type === "update_settings") {
      if (player.id !== room.hostId || room.phase !== "lobby") return;
      room.settings = { ...room.settings, ...event.settings };
      room.settings.gridSize = Math.max(8, Math.min(64, Math.round(room.settings.gridSize)));
      room.settings.rounds = Math.max(1, Math.min(10, Math.round(room.settings.rounds)));
      room.settings.roundSeconds = Math.max(20, Math.min(180, Math.round(room.settings.roundSeconds)));
      room.settings.maxPlayers = Math.max(2, Math.min(8, Math.round(room.settings.maxPlayers)));
      room.canvas = createCanvas(room.settings.gridSize);
      this.sendState(room);
      await this.persist();
      return;
    }

    if (event.type === "start_game") {
      if (player.id !== room.hostId || room.phase !== "lobby") return;
      room.round = 1;
      room.artistOrder = createArtistOrder(room.players);
      room.artistOrderIndex = -1;
      room.players.forEach((roomPlayer) => {
        roomPlayer.score = 0;
      });
      await this.beginChoosing(room);
      return;
    }

    if (event.type === "choose_word") {
      if (player.id !== room.artistId || room.phase !== "choosing-word" || !room.wordChoices.includes(event.word)) return;
      await this.beginDrawing(room, event.word);
      return;
    }

    if (event.type === "draw_patch") {
      if (player.id !== room.artistId || (room.phase !== "drawing" && room.phase !== "free-draw")) return;
      this.applyPatch(room, event.patch);
      this.broadcast({ type: "canvas_patch", patch: event.patch });
      await this.persist();
      return;
    }

    if (event.type === "clear_canvas") {
      if (player.id !== room.artistId || room.phase !== "free-draw") return;
      this.clearCanvas(room);
      this.broadcast({ type: "canvas_cleared", canvas: room.canvas });
      await this.persist();
      return;
    }

    if (event.type === "submit_guess") {
      const text = event.text.trim().slice(0, 120);
      if (!text) return;
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        playerId: player.id,
        playerName: player.name,
        text,
        kind: "chat",
        createdAt: Date.now()
      };
      if (room.phase === "drawing" && player.id !== room.artistId && !player.isSpectator && room.answer && isCorrectGuess(text, room.answer)) {
        if (!room.guessedPlayerIds.has(player.id)) {
          room.guessedPlayerIds.add(player.id);
          player.score += calculateGuesserScore(this.remainingSeconds(room), room.settings.roundSeconds);
          const artist = room.players.find((candidate) => candidate.id === room.artistId);
          if (artist) artist.score += calculateArtistBonus(1);
          message.kind = "correct";
          message.text = "guessed correctly!";
          this.broadcast({ type: "score_update", players: room.players });
          if (shouldEndRound(room.players, room.artistId, room.guessedPlayerIds)) {
            setTimeout(() => {
              void this.endRound(room);
            }, 500);
          }
        }
      }
      room.chat.push(message);
      this.broadcast({ type: "chat_message", message });
      this.sendState(room);
      await this.persist();
    }
  }

  private async disconnect(connection: Party.Connection): Promise<void> {
    const client = connectionState(connection);
    if (!client || !this.state) return;
    const player = this.state.players.find((candidate) => candidate.id === client.playerId);
    if (!player) return;
    const hasReplacementConnection = [...this.room.getConnections()].some((candidate) => {
      const state = connectionState(candidate);
      return candidate.id !== connection.id && state?.roomCode === client.roomCode && state.playerId === client.playerId;
    });
    if (hasReplacementConnection) return;
    player.connected = false;
    await this.addSystemMessage(this.state, `${player.name} disconnected.`);
    this.sendState(this.state);
    await this.persist();
  }
}
