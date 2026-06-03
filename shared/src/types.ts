export type GamePhase = "lobby" | "choosing-word" | "drawing" | "round-results" | "game-over";

export type Tool = "brush" | "eraser" | "fill";

export type RoomSettings = {
  maxPlayers: number;
  rounds: number;
  roundSeconds: number;
  gridSize: number;
  allowSpectators: boolean;
};

export type Player = {
  id: string;
  clientId: string;
  name: string;
  score: number;
  connected: boolean;
  isSpectator: boolean;
};

export type Pixel = {
  x: number;
  y: number;
  color: string | null;
};

export type CanvasPatch = {
  before: Pixel[];
  after: Pixel[];
};

export type ChatMessage = {
  id: string;
  playerId: string | null;
  playerName: string;
  text: string;
  kind: "chat" | "system" | "correct";
  createdAt: number;
};

export type PublicRoomState = {
  code: string;
  hostId: string;
  phase: GamePhase;
  settings: RoomSettings;
  players: Player[];
  artistId: string | null;
  round: number;
  wordProgress: string;
  answer?: string;
  canvas: (string | null)[][];
  chat: ChatMessage[];
  remainingSeconds: number;
  wordChoices?: string[];
  guessedPlayerIds: string[];
};

export type ClientEvent =
  | { type: "create_room"; name: string; clientId: string }
  | { type: "join_room"; roomCode: string; name: string; clientId: string; spectator?: boolean }
  | { type: "rejoin_room"; roomCode: string; clientId: string }
  | { type: "update_settings"; settings: Partial<RoomSettings> }
  | { type: "start_game" }
  | { type: "choose_word"; word: string }
  | { type: "draw_patch"; patch: CanvasPatch }
  | { type: "submit_guess"; text: string }
  | { type: "leave_room" };

export type ServerEvent =
  | { type: "room_state"; state: PublicRoomState }
  | { type: "room_created"; roomCode: string; playerId: string; state: PublicRoomState }
  | { type: "room_joined"; playerId: string; state: PublicRoomState }
  | { type: "word_choices"; choices: string[] }
  | { type: "canvas_patch"; patch: CanvasPatch }
  | { type: "timer_tick"; remainingSeconds: number }
  | { type: "chat_message"; message: ChatMessage }
  | { type: "score_update"; players: Player[] }
  | { type: "round_ended"; answer: string; state: PublicRoomState }
  | { type: "game_over"; state: PublicRoomState }
  | { type: "error"; message: string };

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  rounds: 3,
  roundSeconds: 80,
  gridSize: 32,
  allowSpectators: true
};

export const PALETTE = [
  "#000000",
  "#ffffff",
  "#ff004d",
  "#ffa300",
  "#ffec27",
  "#00e436",
  "#29adff",
  "#83769c",
  "#7e2553",
  "#ab5236",
  "#ff77a8",
  "#ffccaa",
  "#008751",
  "#1d2b53",
  "#c2c3c7",
  "#5f574f"
];
