#!/usr/bin/env node
/**
 * End-to-end socket test against a running server.
 *
 *   npm start            # or npm run dev
 *   npm run test:e2e     # defaults to http://127.0.0.1:3001
 *   URL=http://127.0.0.1:3001 npm run test:e2e
 */

import { io } from "socket.io-client";

const URL = process.env.URL || "http://127.0.0.1:3001";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures += 1;
}

function once(sock, event, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${event}`)), timeout);
    sock.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

const connect = () =>
  new Promise((resolve) => {
    const s = io(URL, { transports: ["websocket"] });
    s.once("connect", () => resolve(s));
  });

console.log(`Testing ${URL}\n`);

const health = await fetch(`${URL}/api/health`).then((r) => r.json());
check("health endpoint", health.ok === true, `${health.sounds} sounds`);

const stage = await connect();
const created = await new Promise((r) => stage.emit("stage:create", {}, r));
check("stage creates a room", created?.ok === true, created?.code);
const code = created.code;

const players = [];
for (const name of ["Abel", "Sara"]) {
  const s = await connect();
  const res = await new Promise((r) => s.emit("player:join", { code, name }, r));
  check(`player ${name} joins`, res?.ok === true);
  players.push(s);
}

// a third player would be rejected with a bad code
const outsider = await connect();
const bad = await new Promise((r) =>
  outsider.emit("player:join", { code: "ZZZZ", name: "Nobody" }, r)
);
check("bad room code is rejected", bad?.ok === false);
outsider.close();

const resultsPromise = once(stage, "round:results", 40000);
stage.emit("stage:start");

await once(stage, "round:demo");
check("demo event", true);
stage.emit("stage:demoDone");

await once(stage, "round:countdown");
check("countdown event", true);
await once(stage, "round:record");
check("record event", true);

players[0].emit("player:submit", {
  score: 82,
  breakdown: { pitch: 80, rhythm: 70, sustain: 90, heardNote: "ጥሩ ነው!" },
});
players[1].emit("player:submit", {
  score: 41,
  breakdown: { pitch: 40, rhythm: 35, sustain: 80, heardNote: "ደግመህ ሞክር" },
});

const results = await resultsPromise;
const list = results.results || [];
check("two results", list.length === 2);
check(
  "sorted ascending (winner last)",
  list.length === 2 && list[0].total <= list[1].total
);
check(
  "bonus applied at 82",
  list.find((r) => r.name === "Abel")?.bonus === 5
);
check(
  "scores stored in room",
  (results.players || []).every((p) => p.total >= 0)
);

const nextPromise = once(stage, "round:next", 15000);
stage.emit("stage:start");
const next = await nextPromise;
check("next round picks another sound", next.sound.id !== results.sound.id);

await wait(300);
stage.emit("stage:skip");
stage.emit("stage:reset");
await wait(300);

for (const p of players) p.close();
stage.close();

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
