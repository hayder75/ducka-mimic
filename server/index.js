import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3001);
const MAX_PLAYERS = 8;
const RECORD_MS = 5000;
const COUNTDOWN_SEC = 3;
const COLLECT_GRACE_MS = 6000;

/* ------------------------------------------------------------------ */
/*  Audio library                                                      */
/* ------------------------------------------------------------------ */

const MANIFEST_PATH = path.join(ROOT, "public", "audio", "manifest.json");

let library = { categories: [], sounds: [] };

function loadLibrary() {
  try {
    const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const categories = Array.isArray(raw.categories) ? raw.categories : [];
    const sounds = (Array.isArray(raw.sounds) ? raw.sounds : [])
      .filter((s) => s && s.id && s.file)
      .map((s) => ({
        id: String(s.id),
        title: s.title || s.id,
        subtitle: s.subtitle || "",
        category: s.category || "misc",
        file: String(s.file).replace(/^\/+/, ""),
        duration: Number(s.duration) > 0 ? Number(s.duration) : 2,
        difficulty: s.difficulty || "medium",
        url: "/audio/" + String(s.file).replace(/^\/+/, ""),
      }));
    library = { categories, sounds };
    console.log(
      `[audio] ${sounds.length} sounds loaded from ${path.relative(ROOT, MANIFEST_PATH)}`
    );
  } catch (err) {
    library = { categories: [], sounds: [] };
    console.error("[audio] could not load manifest:", err.message);
  }
}
loadLibrary();

function publicSound(s) {
  return {
    id: s.id,
    title: s.title,
    subtitle: s.subtitle,
    category: s.category,
    url: s.url,
    duration: s.duration,
    difficulty: s.difficulty,
  };
}

/* ------------------------------------------------------------------ */
/*  Rooms                                                             */
/* ------------------------------------------------------------------ */

const rooms = new Map();

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      alphabet.charAt(Math.floor(Math.random() * alphabet.length))
    ).join("");
  } while (rooms.has(code));
  return code;
}

function makeRoom(stageId) {
  const code = makeCode();
  const room = {
    code,
    stageId,
    players: new Map(),
    state: "lobby",
    roundNumber: 0,
    token: 0,
    round: null,
    pool: [],
    solo: false,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function roomSnapshot(room) {
  return {
    code: room.code,
    state: room.state,
    round: room.roundNumber,
    solo: room.solo,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      avatarSlot: p.avatarSlot,
      total: p.total,
      connected: p.connected,
      lastScore: p.lastScore,
    })),
  };
}

const AVATARS = ["🦆", "🐯", "🐼", "🦊", "🐸", "🐵", "🐧", "🦁", "🐨", "🐰"];

function addPlayer(room, socket, name) {
  const slot = room.players.size % AVATARS.length;
  const player = {
    id: socket.id,
    name: (name || "").trim().slice(0, 16) || "Player",
    avatar: AVATARS[slot],
    avatarSlot: slot,
    total: 0,
    lastScore: null,
    connected: true,
    submitted: false,
  };
  room.players.set(socket.id, player);
  return player;
}

function nextSound(room) {
  if (!library.sounds.length) return null;
  if (!room.pool.length) {
    room.pool = library.sounds.map((s) => s.id);
    for (let i = room.pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [room.pool[i], room.pool[j]] = [room.pool[j], room.pool[i]];
    }
  }
  const id = room.pool.pop();
  return library.sounds.find((s) => s.id === id) || library.sounds[0];
}

function bonusFor(score) {
  if (score >= 96) return 35;
  if (score >= 90) return 15;
  if (score >= 80) return 5;
  return 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runRound(io, room) {
  const token = ++room.token;
  const sound = nextSound(room);
  if (!sound) {
    io.to(room.code).emit("error:msg", { message: "No sounds in the library yet." });
    return;
  }

  room.roundNumber += 1;
  const round = {
    number: room.roundNumber,
    sound,
    submissions: new Map(),
    demoDone: false,
  };
  room.round = round;
  room.state = "demo";
  for (const p of room.players.values()) p.submitted = false;

  io.to(room.code).emit("round:next", {
    round: round.number,
    sound: publicSound(sound),
  });
  // give clients a beat to preload / decode the file
  await sleep(800);
  if (token !== room.token) return;

  io.to(room.code).emit("round:demo", {
    round: round.number,
    sound: publicSound(sound),
  });

  // wait for the stage to report playback finished (fallback: duration + 5s)
  const deadline = Date.now() + sound.duration * 1000 + 5000;
  while (!round.demoDone && Date.now() < deadline) {
    if (token !== room.token) return;
    await sleep(100);
  }
  if (token !== room.token) return;
  await sleep(250);

  io.to(room.code).emit("round:countdown", { from: COUNTDOWN_SEC });
  await sleep(COUNTDOWN_SEC * 1000);
  if (token !== room.token) return;

  room.state = "recording";
  io.to(room.code).emit("round:record", { ms: RECORD_MS });
  await sleep(RECORD_MS + 400);
  if (token !== room.token) return;

  room.state = "collecting";
  io.to(room.code).emit("round:collecting", {
    expected: [...room.players.values()].filter((p) => p.connected).length,
  });

  const collectDeadline = Date.now() + COLLECT_GRACE_MS;
  while (
    Date.now() < collectDeadline &&
    [...room.players.values()].some((p) => p.connected && !p.submitted)
  ) {
    if (token !== room.token) return;
    await sleep(120);
  }
  if (token !== room.token) return;

  const results = [];
  for (const p of room.players.values()) {
    const sub = round.submissions.get(p.id);
    const raw = sub ? Math.max(0, Math.min(100, Math.round(sub.score))) : 0;
    const bonus = sub ? bonusFor(raw) : 0;
    const total = raw + bonus;
    p.lastScore = total;
    p.total += total;
    results.push({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      avatarSlot: p.avatarSlot,
      avatarSlot: p.avatarSlot,
      score: raw,
      bonus,
      total,
      breakdown: sub?.breakdown || null,
      silent: !sub,
    });
  }
  results.sort((a, b) => a.total - b.total); // ascending: winner revealed last

  room.state = "results";
  io.to(room.code).emit("round:results", {
    round: round.number,
    sound: publicSound(sound),
    results,
    players: roomSnapshot(room).players,
  });
}

/* ------------------------------------------------------------------ */
/*  HTTP + sockets                                                    */
/* ------------------------------------------------------------------ */

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, sounds: library.sounds.length, rooms: rooms.size });
});

app.get("/api/sounds", (_req, res) => {
  res.json({
    categories: library.categories,
    sounds: library.sounds.map(publicSound),
  });
});

app.post("/api/reload", (_req, res) => {
  loadLibrary();
  res.json({ ok: true, sounds: library.sounds.length });
});

const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  app.get("/", (_req, res) =>
    res
      .status(200)
      .send("Ducka Mimic API running. Start the web app with: npm run dev")
  );
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
  maxHttpBufferSize: 1e6,
});

io.on("connection", (socket) => {
  let role = null; // 'stage' | 'player'
  let roomCode = null;

  const roomOf = () => (roomCode ? rooms.get(roomCode) : null);

  socket.on("stage:create", (_payload, ack) => {
    const room = makeRoom(socket.id);
    roomCode = room.code;
    role = "stage";
    socket.join(room.code);
    console.log(`[room ${room.code}] created`);
    ack?.({ ok: true, code: room.code });
    io.to(room.code).emit("room:update", roomSnapshot(room));
  });

  socket.on("player:join", ({ code, name } = {}, ack) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return ack?.({ ok: false, error: "Room not found" });
    if (room.players.size >= MAX_PLAYERS)
      return ack?.({ ok: false, error: "Room is full" });

    role = "player";
    roomCode = room.code;
    socket.join(room.code);
    const player = addPlayer(room, socket, name);
    ack?.({
      ok: true,
      player: {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        avatarSlot: player.avatarSlot,
      },
    });
    io.to(room.code).emit("room:update", roomSnapshot(room));
    console.log(`[room ${room.code}] ${player.name} joined (${room.players.size})`);

    // resync a late joiner into the current phase
    if (room.round && (room.state === "demo" || room.state === "recording")) {
      socket.emit("round:next", {
        round: room.round.number,
        sound: publicSound(room.round.sound),
      });
    }
  });

  socket.on("stage:start", () => {
    const room = roomOf();
    if (!room || role !== "stage") return;
    if (!room.players.size && !room.solo) {
      socket.emit("error:msg", { message: "Wait for at least one player, or enable solo." });
      return;
    }
    runRound(io, room).catch((err) => console.error("[round]", err));
  });

  socket.on("stage:demoDone", () => {
    const room = roomOf();
    if (!room || role !== "stage" || !room.round) return;
    room.round.demoDone = true;
  });

  socket.on("stage:skip", () => {
    const room = roomOf();
    if (!room || role !== "stage") return;
    room.token++;
    room.state = "lobby";
    room.round = null;
    io.to(room.code).emit("round:closed", {});
    io.to(room.code).emit("room:update", roomSnapshot(room));
  });

  socket.on("stage:reset", () => {
    const room = roomOf();
    if (!room || role !== "stage") return;
    room.token++;
    room.state = "lobby";
    room.round = null;
    room.roundNumber = 0;
    room.pool = [];
    for (const p of room.players.values()) {
      p.total = 0;
      p.lastScore = null;
      p.submitted = false;
    }
    io.to(room.code).emit("round:closed", {});
    io.to(room.code).emit("room:update", roomSnapshot(room));
  });

  socket.on("stage:solo", ({ enabled } = {}) => {
    const room = roomOf();
    if (!room || role !== "stage") return;
    room.solo = Boolean(enabled);
    if (room.solo && !room.players.has(socket.id)) {
      addPlayer(room, socket, "Streamer");
    } else if (!room.solo) {
      room.players.delete(socket.id);
    }
    io.to(room.code).emit("room:update", roomSnapshot(room));
  });

  socket.on("player:level", ({ level } = {}) => {
    const room = roomOf();
    if (!room) return;
    socket.to(room.code).emit("player:level", {
      id: socket.id,
      level: Number(level) || 0,
    });
  });

  socket.on("player:submit", (payload = {}) => {
    const room = roomOf();
    if (!room || !room.round) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    const score = Number(payload.score);
    if (!Number.isFinite(score)) return;
    room.round.submissions.set(socket.id, {
      score,
      breakdown: payload.breakdown || null,
    });
    player.submitted = true;
    io.to(room.code).emit("round:collecting", {
      expected: [...room.players.values()].filter((p) => p.connected).length,
      received: room.round.submissions.size,
    });
  });

  socket.on("disconnect", () => {
    const room = roomOf();
    if (!room) return;
    if (role === "stage") {
      room.token++;
      rooms.delete(room.code);
      io.to(room.code).emit("room:closed", {});
      console.log(`[room ${room.code}] closed`);
      return;
    }
    room.players.delete(socket.id);
    io.to(room.code).emit("room:update", roomSnapshot(room));
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] http://localhost:${PORT}`);
  console.log(`[server] dev web app: http://localhost:5173`);
});
