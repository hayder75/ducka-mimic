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

stage.emit("stage:teams", { enabled: true });
await wait(200);

const players = [];
const teamSeen = [];
for (const name of ["Abel", "Sara"]) {
  const s = await connect();
  const res = await new Promise((r) => s.emit("player:join", { code, name }, r));
  check(`player ${name} joins`, res?.ok === true);
  teamSeen.push(res.player?.team);
  players.push(s);
}
check("teams assigned A/B", teamSeen.includes("A") && teamSeen.includes("B"), teamSeen.join("/"));

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
check(
  "results carry team",
  list.every((r) => r.team === "A" || r.team === "B")
);

// wheel: spin, check the broadcast, then verify it is applied next round
const wheelPromise = once(stage, "wheel:result", 10000);
stage.emit("stage:wheel");
const wheel = await wheelPromise;
check("wheel returns a segment", typeof wheel.index === "number");
check("wheel has a label", Boolean(wheel.segment?.label));

const nextPromise = once(stage, "round:next", 15000);
stage.emit("stage:start");
const next = await nextPromise;
check("next round picks another sound", next.sound.id !== results.sound.id);

// submit again and verify the wheel effect was applied to its target
const results2Promise = once(stage, "round:results", 40000);
stage.emit("stage:demoDone");
await once(stage, "round:countdown");
await once(stage, "round:record");
players[0].emit("player:submit", { score: 80 });
players[1].emit("player:submit", { score: 40 });
const results2 = await results2Promise;
const target = wheel.player ? results2.results.find((r) => r.id === wheel.player.id) : null;

let expectedOk = true;
if (target) {
  if (wheel.segment.kind === "points") {
    expectedOk = Boolean(target.wheel);
  } else if (wheel.segment.kind === "double") {
    expectedOk = target.wheel?.kind === "double";
  } else if (wheel.segment.kind === "sabotage") {
    expectedOk = Boolean(target.sabotage);
  }
}
check("wheel effect applied next round", expectedOk, wheel.segment.label);

await wait(300);
stage.emit("stage:skip");
stage.emit("stage:reset");
await wait(300);

for (const p of players) p.close();
stage.close();

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
