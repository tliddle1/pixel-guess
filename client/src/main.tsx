import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import PartySocket from "partysocket";
import { DEFAULT_SETTINGS, PALETTE, type CanvasPatch, type ClientEvent, type Pixel, type PublicRoomState, type ServerEvent, type Tool } from "@shared/types";
import "./styles.css";

const clientIdKey = "pixel-guess-session-id";
const currentRoomKey = "pixel-guess-current-room";
const localFreeDrawCode = "LOCAL";
const configuredPartyHost = import.meta.env.VITE_PARTYKIT_HOST as string | undefined;
const partyHost = configuredPartyHost || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "localhost:1999" : "");

type GameSocket = Pick<PartySocket, "addEventListener" | "close" | "readyState" | "send">;

function roomCodeApiUrl(): string {
  const protocol = partyHost.includes("localhost") || partyHost.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${partyHost}/api/rooms`;
}

function browserId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  if (crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((byte, index) => `${[4, 6, 8, 10].includes(index) ? "-" : ""}${byte.toString(16).padStart(2, "0")}`).join("");
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clientId(): string {
  const existing = sessionStorage.getItem(clientIdKey);
  if (existing) return existing;
  const created = browserId();
  sessionStorage.setItem(clientIdKey, created);
  return created;
}

function rememberRoom(roomCode: string): void {
  sessionStorage.setItem(currentRoomKey, roomCode);
}

function forgetRoom(): void {
  sessionStorage.removeItem(currentRoomKey);
}

function send(socket: GameSocket | null, event: ClientEvent): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function cloneCanvas(canvas: (string | null)[][]): (string | null)[][] {
  return canvas.map((row) => [...row]);
}

function createCanvas(size: number): (string | null)[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function applyPatch(canvas: (string | null)[][], patch: CanvasPatch): (string | null)[][] {
  const next = cloneCanvas(canvas);
  for (const pixel of patch.after) {
    if (next[pixel.y]?.[pixel.x] !== undefined) next[pixel.y][pixel.x] = pixel.color;
  }
  return next;
}

function makePatch(canvas: (string | null)[][], x: number, y: number, color: string | null): CanvasPatch | null {
  const current = canvas[y]?.[x];
  if (current === undefined || current === color) return null;
  return {
    before: [{ x, y, color: current }],
    after: [{ x, y, color }]
  };
}

function makeFillPatch(canvas: (string | null)[][], x: number, y: number, color: string | null): CanvasPatch | null {
  const target = canvas[y]?.[x];
  if (target === undefined || target === color) return null;
  const size = canvas.length;
  const visited = new Set<string>();
  const stack: Array<[number, number]> = [[x, y]];
  const before: Pixel[] = [];
  const after: Pixel[] = [];

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    const key = `${cx},${cy}`;
    if (visited.has(key) || cx < 0 || cy < 0 || cx >= size || cy >= size || canvas[cy][cx] !== target) continue;
    visited.add(key);
    before.push({ x: cx, y: cy, color: target });
    after.push({ x: cx, y: cy, color });
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }

  return before.length ? { before, after } : null;
}

function inversePatch(patch: CanvasPatch): CanvasPatch {
  return { before: patch.after, after: patch.before };
}

function makeClearPatch(canvas: (string | null)[][]): CanvasPatch | null {
  const before: Pixel[] = [];
  const after: Pixel[] = [];
  canvas.forEach((row, y) =>
    row.forEach((color, x) => {
      if (!color) return;
      before.push({ x, y, color });
      after.push({ x, y, color: null });
    })
  );
  return before.length ? { before, after } : null;
}

function PixelBoard({
  canvas,
  enabled,
  tool,
  color,
  onPatch
}: {
  canvas: (string | null)[][];
  enabled: boolean;
  tool: Tool;
  color: string;
  onPatch: (patch: CanvasPatch) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const size = canvas.length || DEFAULT_SETTINGS.gridSize;

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const scale = Math.max(8, Math.floor(640 / size));
    element.width = size * scale;
    element.height = size * scale;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#f8f7f0";
    ctx.fillRect(0, 0, element.width, element.height);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const cell = canvas[y]?.[x];
        if (cell) {
          ctx.fillStyle = cell;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }

    ctx.strokeStyle = "rgba(29, 43, 83, 0.16)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * scale + 0.5, 0);
      ctx.lineTo(i * scale + 0.5, element.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * scale + 0.5);
      ctx.lineTo(element.width, i * scale + 0.5);
      ctx.stroke();
    }

    if (hover && enabled) {
      ctx.fillStyle = tool === "eraser" ? "rgba(255,255,255,0.65)" : `${color}99`;
      ctx.fillRect(hover.x * scale, hover.y * scale, scale, scale);
      ctx.strokeStyle = "#ff004d";
      ctx.lineWidth = 3;
      ctx.strokeRect(hover.x * scale + 1, hover.y * scale + 1, scale - 2, scale - 2);
    }
  }, [canvas, color, enabled, hover, size, tool]);

  function pointerCell(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const element = canvasRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * size);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * size);
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    return { x, y };
  }

  function paint(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!enabled) return;
    const cell = pointerCell(event);
    if (!cell) return;
    const paintColor = tool === "eraser" ? null : color;
    const patch = tool === "fill" ? makeFillPatch(canvas, cell.x, cell.y, paintColor) : makePatch(canvas, cell.x, cell.y, paintColor);
    if (patch) onPatch(patch);
  }

  return (
    <canvas
      ref={canvasRef}
      className={`pixel-board ${enabled ? "is-active" : ""}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        paint(event);
      }}
      onPointerMove={(event) => {
        const cell = pointerCell(event);
        setHover(cell);
        if (event.buttons === 1 && tool !== "fill") paint(event);
      }}
      onPointerLeave={() => setHover(null)}
    />
  );
}

function App() {
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState("Pixel Pal");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [error, setError] = useState("");
  const [guess, setGuess] = useState("");
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState(PALETTE[2]);
  const [undoStack, setUndoStack] = useState<CanvasPatch[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasPatch[]>([]);
  const cid = useMemo(clientId, []);
  const socketRef = useRef<GameSocket | null>(null);
  const openEventRef = useRef<ClientEvent | null>(null);

  useEffect(() => {
    const roomCode = sessionStorage.getItem(currentRoomKey);
    if (roomCode) connectToRoom(roomCode, { type: "rejoin_room", roomCode, clientId: cid });
    return () => socketRef.current?.close();
  }, []);

  function connectToRoom(roomCode: string, event: ClientEvent): void {
    if (!partyHost) {
      setError("Missing VITE_PARTYKIT_HOST. Set it to your PartyKit host before deploying.");
      return;
    }

    socketRef.current?.close();
    setConnected(false);
    openEventRef.current = event;
    const ws = new PartySocket({ host: partyHost, room: roomCode.toUpperCase() });
    ws.addEventListener("open", () => {
      setConnected(true);
      if (openEventRef.current) ws.send(JSON.stringify(openEventRef.current));
    });
    ws.addEventListener("close", () => setConnected(false));
    ws.addEventListener("message", (message) => {
      const event = JSON.parse(message.data) as ServerEvent;
      if (event.type === "error") {
        setError(event.message);
        if (event.message.toLowerCase().includes("rejoin")) forgetRoom();
      }
      if (event.type === "room_created" || event.type === "room_joined") {
        setPlayerId(event.playerId);
        setState(event.state);
        rememberRoom(event.state.code);
        openEventRef.current = { type: "rejoin_room", roomCode: event.state.code, clientId: cid };
        setError("");
      }
      if (event.type === "room_state") setState(event.state);
      if (event.type === "canvas_patch") {
        setState((current) => (current ? { ...current, canvas: applyPatch(current.canvas, event.patch) } : current));
      }
      if (event.type === "canvas_cleared") {
        setUndoStack([]);
        setRedoStack([]);
        setState((current) => (current ? { ...current, canvas: event.canvas } : current));
      }
      if (event.type === "chat_message") {
        setState((current) => (current ? { ...current, chat: [...current.chat.slice(-49), event.message] } : current));
      }
      if (event.type === "score_update") {
        setState((current) => (current ? { ...current, players: event.players } : current));
      }
      if (event.type === "timer_tick") {
        setState((current) => (current ? { ...current, remainingSeconds: event.remainingSeconds } : current));
      }
      if (event.type === "round_ended" || event.type === "game_over") {
        setUndoStack([]);
        setRedoStack([]);
        setState(event.state);
      }
    });
    socketRef.current = ws;
    setSocket(ws);
  }

  function returnToMenu(): void {
    const freeDrawMessage = "Return to the main menu? Your free draw will be cleared.";
    const roomMessage = "Disconnect from this room and return to the main menu?";
    if (!window.confirm(isLocalFreeDraw ? freeDrawMessage : roomMessage)) return;
    if (!isLocalFreeDraw) send(socket, { type: "leave_room" });
    socketRef.current?.close();
    socketRef.current = null;
    openEventRef.current = null;
    setSocket(null);
    setConnected(false);
    setPlayerId(null);
    setState(null);
    setError("");
    setGuess("");
    setUndoStack([]);
    setRedoStack([]);
    forgetRoom();
  }

  const me = state?.players.find((player) => player.id === playerId) ?? null;
  const artist = state?.players.find((player) => player.id === state.artistId) ?? null;
  const isHost = Boolean(me && state?.hostId === me.id);
  const isFreeDraw = state?.phase === "free-draw";
  const canDraw = Boolean(me && state?.artistId === me.id && (state.phase === "drawing" || state.phase === "free-draw"));
  const canClear = canDraw;
  const canChooseWord = Boolean(me && state?.artistId === me.id && state.phase === "choosing-word");
  const rankedPlayers = [...(state?.players ?? [])].sort((a, b) => b.score - a.score);
  const isLocalFreeDraw = state?.phase === "free-draw" && state.code === localFreeDrawCode;

  function startLocalFreeDraw(): void {
    socketRef.current?.close();
    setSocket(null);
    setConnected(false);
    forgetRoom();
    const playerId = `local-${cid}`;
    setPlayerId(playerId);
    setUndoStack([]);
    setRedoStack([]);
    setError("");
    setState({
      code: localFreeDrawCode,
      hostId: playerId,
      phase: "free-draw",
      settings: { ...DEFAULT_SETTINGS },
      players: [{ id: playerId, clientId: cid, name: name.trim().slice(0, 24) || "Player", score: 0, connected: true, isSpectator: false }],
      artistId: playerId,
      round: 1,
      wordProgress: "",
      canvas: createCanvas(DEFAULT_SETTINGS.gridSize),
      chat: [
        {
          id: browserId(),
          playerId: null,
          playerName: "System",
          text: "Started a local free draw.",
          kind: "system",
          createdAt: Date.now()
        }
      ],
      remainingSeconds: 0,
      guessedPlayerIds: []
    });
  }

  async function createRoom(): Promise<void> {
    if (!partyHost) {
      setError("Missing VITE_PARTYKIT_HOST. Set it to your PartyKit host before deploying.");
      return;
    }
    try {
      const response = await fetch(roomCodeApiUrl(), { method: "POST" });
      if (!response.ok) throw new Error("Could not create a room code.");
      const payload = (await response.json()) as { roomCode: string };
      connectToRoom(payload.roomCode, { type: "create_room", name, clientId: cid });
    } catch {
      setError("Could not reach the PartyKit room service.");
    }
  }

  function createFreeDraw(): void {
    startLocalFreeDraw();
  }

  function joinRoom(spectator = false): void {
    const roomCode = roomCodeInput.toUpperCase();
    connectToRoom(roomCode, { type: "join_room", roomCode, name, clientId: cid, spectator });
  }

  function drawPatch(patch: CanvasPatch): void {
    setUndoStack((stack) => [...stack, patch].slice(-80));
    setRedoStack([]);
    if (isLocalFreeDraw) {
      setState((current) => (current ? { ...current, canvas: applyPatch(current.canvas, patch) } : current));
      return;
    }
    send(socket, { type: "draw_patch", patch });
  }

  function undo(): void {
    const patch = undoStack.at(-1);
    if (!patch) return;
    const inverse = inversePatch(patch);
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, patch]);
    if (isLocalFreeDraw) {
      setState((current) => (current ? { ...current, canvas: applyPatch(current.canvas, inverse) } : current));
      return;
    }
    send(socket, { type: "draw_patch", patch: inverse });
  }

  function redo(): void {
    const patch = redoStack.at(-1);
    if (!patch) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, patch]);
    if (isLocalFreeDraw) {
      setState((current) => (current ? { ...current, canvas: applyPatch(current.canvas, patch) } : current));
      return;
    }
    send(socket, { type: "draw_patch", patch });
  }

  function clearBoard(): void {
    if (!canClear || !state) return;
    const patch = makeClearPatch(state.canvas);
    if (!patch) return;
    setRedoStack([]);
    if (isLocalFreeDraw) {
      setUndoStack((stack) => [...stack, patch].slice(-80));
      setState((current) => (current ? { ...current, canvas: applyPatch(current.canvas, patch) } : current));
      return;
    }
    setUndoStack([]);
    send(socket, { type: "clear_canvas" });
  }

  function submitGuess(event: React.FormEvent): void {
    event.preventDefault();
    send(socket, { type: "submit_guess", text: guess });
    setGuess("");
  }

  function saveDrawing(): void {
    if (!state) return;
    const size = state.canvas.length;
    const scale = 16;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = size * scale;
    exportCanvas.height = size * scale;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f8f7f0";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    state.canvas.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (!cell) return;
        ctx.fillStyle = cell;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      })
    );
    const link = document.createElement("a");
    link.download = `pixel-guess-${state.code}-${Date.now()}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  }

  if (!state) {
    return (
      <main className="entry-shell">
        <section className="entry-panel">
          <div>
            <p className="eyebrow">Pixel Guess</p>
            <h1>Draw tiny. Guess fast.</h1>
          </div>
          <label>
            Display name
            <input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="entry-actions">
            <div className="create-row">
              <button onClick={createRoom} disabled={!partyHost}>Create room</button>
              <button className="secondary" onClick={createFreeDraw}>Free draw</button>
            </div>
            <div className="join-row">
              <input placeholder="ROOM" value={roomCodeInput} maxLength={4} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())} />
              <button onClick={() => joinRoom(false)} disabled={!partyHost || roomCodeInput.length < 4}>Join</button>
              <button className="secondary" onClick={() => joinRoom(true)} disabled={!partyHost || roomCodeInput.length < 4}>Watch</button>
            </div>
          </div>
          <p className="status">{connected ? "Room connected" : partyHost ? "Choose or join a room" : "Free draw works offline"}</p>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="room-summary">
          <span className="eyebrow">{isFreeDraw ? "Free draw" : `Room ${state.code}`}</span>
          <strong>{isFreeDraw ? "Open canvas" : state.phase === "game-over" ? "Final rankings" : `Round ${Math.min(state.round, state.settings.rounds)} / ${state.settings.rounds}`}</strong>
        </div>
        {!isFreeDraw && <div className="timer">{state.remainingSeconds}s</div>}
        <div className="topbar-actions">
          <div className="artist">{isFreeDraw ? "Drawing" : "Artist"}: {artist?.name ?? "TBD"}</div>
          <button className="secondary compact-action" onClick={returnToMenu}>{isLocalFreeDraw ? "Menu" : "Leave"}</button>
        </div>
      </header>

      <aside className="players">
        <h2>Players</h2>
        {rankedPlayers.map((player, index) => (
          <div className="player-row" key={player.id}>
            <span>{index + 1}. {player.name}{player.id === state.artistId ? " *" : ""}</span>
            <strong>{player.score}</strong>
          </div>
        ))}
        {isHost && state.phase === "lobby" && (
          <div className="settings">
            <label>Rounds <input type="number" value={state.settings.rounds} min={1} max={10} onChange={(event) => send(socket, { type: "update_settings", settings: { rounds: Number(event.target.value) } })} /></label>
            <label>Timer <input type="number" value={state.settings.roundSeconds} min={20} max={180} onChange={(event) => send(socket, { type: "update_settings", settings: { roundSeconds: Number(event.target.value) } })} /></label>
            <label>Grid <input type="number" value={state.settings.gridSize} min={8} max={64} onChange={(event) => send(socket, { type: "update_settings", settings: { gridSize: Number(event.target.value) } })} /></label>
            <button onClick={() => send(socket, { type: "start_game" })}>Start game</button>
          </div>
        )}
      </aside>

      <section className="board-zone">
        <div className="word-line">
          {isFreeDraw ? "Free draw" : canChooseWord ? "Choose a word" : state.wordProgress || "Waiting in lobby"}
        </div>
        {canChooseWord && (
          <div className="word-choices">
            {(state.wordChoices ?? []).map((word) => (
              <button key={word} onClick={() => send(socket, { type: "choose_word", word })}>{word}</button>
            ))}
          </div>
        )}
        <PixelBoard canvas={state.canvas} enabled={canDraw} tool={tool} color={color} onPatch={drawPatch} />
        <div className="toolbar" aria-disabled={!canDraw}>
          <button className={tool === "brush" ? "selected" : ""} onClick={() => setTool("brush")} title="Brush">Brush</button>
          <button className={tool === "eraser" ? "selected" : ""} onClick={() => setTool("eraser")} title="Eraser">Eraser</button>
          <button className={tool === "fill" ? "selected" : ""} onClick={() => setTool("fill")} title="Fill">Fill</button>
          <button onClick={undo} disabled={!canDraw || undoStack.length === 0} title="Undo">Undo</button>
          <button onClick={redo} disabled={!canDraw || redoStack.length === 0} title="Redo">Redo</button>
          <button className="danger" onClick={clearBoard} disabled={!canClear} title="Clear board">Clear</button>
          <button onClick={saveDrawing} title="Save drawing">Save</button>
        </div>
        <div className="palette">
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              className={color === swatch ? "selected" : ""}
              style={{ background: swatch }}
              onClick={() => {
                setColor(swatch);
                setTool("brush");
              }}
              title={swatch}
            />
          ))}
        </div>
      </section>

      <aside className="chat">
        <h2>Chat</h2>
        <form onSubmit={submitGuess}>
          <input value={guess} onChange={(event) => setGuess(event.target.value)} placeholder={isFreeDraw ? "Free draw has no guesses" : me?.id === state.artistId ? "Artists cannot guess" : "Type a guess"} disabled={state.phase !== "drawing" || me?.id === state.artistId} />
          <button disabled={!guess.trim()}>Send</button>
        </form>
        <div className="messages">
          {[...state.chat].reverse().map((message) => (
            <p key={message.id} className={message.kind}>
              <strong>{message.playerName}</strong> {message.text}
            </p>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
