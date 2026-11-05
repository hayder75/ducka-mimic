import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import Avatar from "../components/Avatar";
import {
  socket,
  type PlayerView,
  type SoundView,
  type ResultView,
} from "../lib/socket";
import {
  unlockAudio,
  ensureMic,
  loadSound,
  playSound,
  recordSamples,
  scoreAttempt,
  sfx,
  analyzeSamplesAsync,
  playClip,
  type Features,
} from "../lib/audio";

// players see the same 3D stage on their own screen, but the chunk only loads
// after they join
const Stage3D = lazy(() => import("../components/Stage3D"));

type Phase =
  | "join"
  | "lobby"
  | "listen"
  | "countdown"
  | "record"
  | "locked"
  | "results"
  | "closed";

export default function Play() {
  const params = new URLSearchParams(window.location.search);

  const [code, setCode] = useState((params.get("code") || "").toUpperCase());
  const [name, setName] = useState(() => localStorage.getItem("ducka:name") || "");
  const [phase, setPhase] = useState<Phase>("join");
  const [me, setMe] = useState<{
    id: string;
    name: string;
    avatar: string;
    avatarSlot?: number;
  } | null>(null);
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [sound, setSound] = useState<SoundView | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [level, setLevel] = useState(0);
  const [recordMs, setRecordMs] = useState(5000);
  const [myResult, setMyResult] = useState<ResultView | null>(null);
  const [results, setResults] = useState<ResultView[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [myTotal, setMyTotal] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [micOk, setMicOk] = useState(true);
  const [round, setRound] = useState(0);

  const demoFeatures = useRef<Features | null>(null);
  const meRef = useRef(me);
  meRef.current = me;
  const lastLevelSent = useRef(0);
  const levelsRef = useRef<Record<string, number>>({});

  /* ---------------- join ---------------- */

  const join = useCallback(async () => {
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();
    if (cleanCode.length < 4) return setError("Enter the 4-letter room code.");
    if (!cleanName) return setError("Enter your name.");

    setBusy(true);
    setError("");

    try {
      await unlockAudio();
    } catch {
      /* retried on the next tap */
    }

    try {
      await ensureMic();
      setMicOk(true);
    } catch {
      setMicOk(false);
    }

    localStorage.setItem("ducka:name", cleanName);
    socket.emit("player:join", { code: cleanCode, name: cleanName }, (res: any) => {
      setBusy(false);
      if (!res?.ok) {
        setError(res?.error || "Could not join.");
        return;
      }
      setMe(res.player);
      setPhase("lobby");
    });
  }, [code, name]);

  /* ---------------- socket ---------------- */

  useEffect(() => {
    const onUpdate = (snap: any) => {
      setPlayers(snap.players || []);
      const mine = (snap.players || []).find((p: PlayerView) => p.id === meRef.current?.id);
      if (mine) setMyTotal(mine.total);
    };

    const onNext = (p: any) => {
      setSound(p.sound);
      setRound(p.round);
      levelsRef.current = {};
      void loadSound(p.sound.url).catch(() => {});
    };

    const onDemo = (p: any) => {
      setSound(p.sound);
      setRound(p.round);
      setPhase("listen");
      if (!meRef.current) return;
      void (async () => {
        try {
          const { features } = await loadSound(p.sound.url);
          demoFeatures.current = features;
          await playSound(p.sound.url);
        } catch (err) {
          console.error(err);
        }
      })();
    };

    const onCountdown = (p: any) => {
      if (!meRef.current) return;
      setPhase("countdown");
      let n = Number(p.from) || 3;
      setCountdown(n);
      sfx("tick");
      const timer = window.setInterval(() => {
        n -= 1;
        if (n <= 0) {
          window.clearInterval(timer);
          setCountdown(0);
          sfx("go");
        } else {
          setCountdown(n);
          sfx("tick");
        }
      }, 1000);
    };

    const onRecord = (p: any) => {
      if (!meRef.current) return;
      const ms = Number(p.ms) || 5000;
      setRecordMs(ms);
      setLevel(0);
      setPhase("record");
      if (navigator.vibrate) navigator.vibrate(120);
      void record(ms);
    };

    const onResults = (p: any) => {
      if (!meRef.current) return;
      const list: ResultView[] = p.results || [];
      setResults(list);
      setPlayers(p.players || []);
      const mine = list.find((r) => r.id === meRef.current?.id) || null;
      setMyResult(mine);
      setPhase("results");
    };

    const onClosed = () => {
      if (!meRef.current) return;
      setPhase("lobby");
      setMyResult(null);
      setResults([]);
      setRevealed(0);
    };

    const onRoomClosed = () => {
      setMe(null);
      setPhase("closed");
    };

    const onLevel = (p: any) => {
      if (p?.id) levelsRef.current[p.id] = Number(p.level) || 0;
    };

    const onError = (p: any) => setError(p?.message || "Something went wrong");

    const onDisconnect = () => {
      if (meRef.current) setError("Connection lost. Reconnecting…");
    };

    socket.on("room:update", onUpdate);
    socket.on("round:next", onNext);
    socket.on("round:demo", onDemo);
    socket.on("round:countdown", onCountdown);
    socket.on("round:record", onRecord);
    socket.on("round:results", onResults);
    socket.on("round:closed", onClosed);
    socket.on("room:closed", onRoomClosed);
    socket.on("player:level", onLevel);
    socket.on("error:msg", onError);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("room:update", onUpdate);
      socket.off("round:next", onNext);
      socket.off("round:demo", onDemo);
      socket.off("round:countdown", onCountdown);
      socket.off("round:record", onRecord);
      socket.off("round:results", onResults);
      socket.off("round:closed", onClosed);
      socket.off("room:closed", onRoomClosed);
      socket.off("player:level", onLevel);
      socket.off("error:msg", onError);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  /* ---------------- reveal animation ---------------- */

  useEffect(() => {
    if (phase !== "results" || !results.length) return;
    let cancelled = false;
    setRevealed(0);
    (async () => {
      for (let i = 0; i < results.length; i++) {
        if (cancelled) return;
        const r = results[i];
        if (r.audioUrl) await playClip(r.audioUrl);
        if (cancelled) return;
        setRevealed(i + 1);
        await new Promise((res) => window.setTimeout(res, 900));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, results]);

  /* ---------------- record + score ---------------- */

  const record = async (ms: number) => {
    try {
      const { samples, sampleRate, blob } = await recordSamples(ms, (v) => {
        setLevel(v);
        const now = performance.now();
        if (now - lastLevelSent.current > 110) {
          lastLevelSent.current = now;
          socket.emit("player:level", { level: v });
        }
      });
      socket.emit("player:level", { level: 0 });
      const attempt = await analyzeSamplesAsync(samples, sampleRate);
      const demo = demoFeatures.current;
      const scored = demo ? scoreAttempt(demo, attempt) : { score: 0, breakdown: null };
      const audio = blob ? await blob.arrayBuffer() : null;
      socket.emit("player:submit", {
        score: scored.score,
        breakdown: scored.breakdown,
        audio,
        mime: blob?.type || "",
      });
      setPhase("locked");
    } catch (err) {
      console.error(err);
      setError("Recording failed. Check your microphone permission.");
      socket.emit("player:submit", { score: 0 });
      setPhase("locked");
    }
  };

  /* ---------------- render ---------------- */

  if (!me || phase === "join" || phase === "closed") {
    return (
      <JoinScreen
        code={code}
        name={name}
        busy={busy}
        error={error}
        closed={phase === "closed"}
        onCode={(v) => setCode(v.toUpperCase().slice(0, 4))}
        onName={setName}
        onJoin={join}
      />
    );
  }

  const rank = myResult ? results.length - results.indexOf(myResult) : 0;
  const myIndex = me ? results.findIndex((r) => r.id === me.id) : -1;
  const myTurn = myIndex >= 0 && revealed > myIndex;
  const playing = phase === "results" ? results[revealed] || null : null;
  const scenePhase =
    phase === "listen"
      ? "demo"
      : phase === "countdown"
      ? "countdown"
      : phase === "record" || phase === "locked"
      ? "record"
      : phase === "results"
      ? "results"
      : "lobby";

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-bg no-select">
      <Suspense fallback={<div className="absolute inset-0 bg-bg" />}>
        <Stage3D
          players={players}
          levels={levelsRef}
          phase={scenePhase}
          results={results}
          revealed={revealed}
          solo={false}
          compact
          meId={me.id}
        />
      </Suspense>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/85 via-black/20 to-black/90" />

      <div className="relative z-10 flex min-h-[100dvh] flex-col">
        <header className="flex items-center justify-between px-5 pt-5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-red text-sm font-black text-white">
              D
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-red">
              Mimic Party
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur">
            <span className="text-base">
              <Avatar slot={me.avatarSlot} emoji={me.avatar} className="h-6 w-6" />
            </span>
            <span className="max-w-[90px] truncate text-xs font-bold">{me.name}</span>
            <span className="text-xs font-black tabular-nums text-red">{myTotal}</span>
          </div>
        </header>

        <main className="flex flex-1 flex-col items-center justify-between px-6 py-4 text-center">
          {/* ---------------- top block ---------------- */}
          <div className="flex w-full max-w-sm flex-col items-center">
            {phase === "lobby" && (
              <>
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                  You're in · room {code}
                </div>
                <h1 className="mt-2 text-2xl font-black">{me.name}</h1>
                <p className="mt-1 text-xs font-medium text-cream/60">
                  Waiting for the host to start…
                </p>
                {!micOk && (
                  <div className="mt-3 rounded-xl border border-red/30 bg-red/10 px-3 py-2 text-[11px] font-semibold leading-relaxed text-red">
                    Microphone blocked — enable it or you'll score 0.
                  </div>
                )}
              </>
            )}

            {phase === "listen" && (
              <>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-cream/70">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red" />
                  Listen carefully
                </div>
                <h1 className="mt-3 text-2xl font-black leading-tight">
                  {sound?.title || "…"}
                </h1>
                <div className="mt-3 flex h-12 w-full items-center justify-center gap-[2px]">
                  {Array.from({ length: 24 }).map((_, i) => {
                    const h = 0.25 + (Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.7;
                    return (
                      <div
                        key={i}
                        className="w-full max-w-[6px] animate-pulse rounded-full bg-red/80"
                        style={{ height: `${20 + h * 70}%`, animationDelay: `${i * 45}ms` }}
                      />
                    );
                  })}
                </div>
              </>
            )}

            {phase === "countdown" && (
              <>
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                  Get ready
                </div>
                <div className="animate-pop text-[6rem] font-black leading-none text-red">
                  {countdown > 0 ? countdown : "GO!"}
                </div>
              </>
            )}

            {phase === "record" && (
              <>
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-red">
                  Mimic it now
                </div>
                <div className="mt-1 text-3xl font-black">
                  {Math.round(recordMs / 1000)}s
                </div>
              </>
            )}

            {phase === "locked" && (
              <>
                <div className="text-2xl">✓</div>
                <h1 className="mt-1 text-xl font-black">Score locked</h1>
                <p className="mt-1 text-[11px] font-medium text-cream/60">
                  Watch the stage for the reveal.
                </p>
              </>
            )}

            {phase === "results" && (
              <>
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                  Round {round}
                </div>
                {myTurn ? (
                  <>
                    <div className="mt-1 animate-pop text-[4.5rem] font-black leading-none tabular-nums">
                      {myResult?.total ?? 0}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                      {myResult?.bonus ? `+${myResult.bonus} bonus · ` : ""}
                      points
                    </div>
                    <div className="mt-1 text-xs font-semibold text-cream/70">
                      {myResult?.breakdown?.heardNote ||
                        (myResult?.silent ? "No sound heard" : "")}
                    </div>
                    {rank > 0 && (
                      <div className="mt-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-cream/80">
                        #{rank} of {results.length}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-2 text-xs font-semibold text-cream/60">
                    Listening to the takes…
                  </div>
                )}
              </>
            )}
          </div>

          {/* ---------------- bottom block ---------------- */}
          <div className="flex w-full max-w-sm flex-col items-center pb-1">
            {phase === "lobby" && (
              <>
                <div className="flex flex-wrap justify-center gap-2">
                  {players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-bold ring-1 ring-white/10 backdrop-blur"
                    >
                      <Avatar slot={p.avatarSlot} emoji={p.avatar} className="h-4 w-4" />
                      <span className="max-w-[80px] truncate">{p.name}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] font-medium text-muted">
                  🎧 Headphones on. One shot only.
                </p>
              </>
            )}

            {phase === "listen" && (
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                One shot only
              </p>
            )}

            {phase === "record" && (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-red transition-[width] duration-100"
                    style={{ width: `${level * 100}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-red">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red" />
                  Recording
                </div>
              </>
            )}

            {phase === "results" && (
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                {playing ? `Now playing · ${playing.name}` : "Next round soon…"}
              </p>
            )}

            {error && (
              <div className="mt-2 rounded-xl bg-red/15 px-3 py-1.5 text-[10px] font-semibold text-red">
                {error}
              </div>
            )}
          </div>
        </main>

        <footer className="pb-4 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          duckalabs.com
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Join screen                                                       */
/* ------------------------------------------------------------------ */

function JoinScreen({
  code,
  name,
  busy,
  error,
  closed,
  onCode,
  onName,
  onJoin,
}: {
  code: string;
  name: string;
  busy: boolean;
  error: string;
  closed: boolean;
  onCode: (v: string) => void;
  onName: (v: string) => void;
  onJoin: () => void;
}) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-bg bg-glow px-6 no-select">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />

      <div className="relative w-full max-w-sm">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-red text-lg font-black text-white">
            D
          </div>
          <div className="leading-none">
            <div className="text-[11px] font-black uppercase tracking-[0.28em] text-red">
              Ducka Labs
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
              Mimic Party
            </div>
          </div>
        </div>

        <h1 className="mt-8 text-4xl font-black leading-none">
          Join the
          <br />
          <span className="text-red">game.</span>
        </h1>

        {closed && (
          <div className="mt-5 rounded-xl border border-red/30 bg-red/10 px-4 py-3 text-sm font-semibold text-red">
            The host closed this game.
          </div>
        )}

        <label className="mt-7 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Room code
        </label>
        <input
          value={code}
          onChange={(e) => onCode(e.target.value)}
          placeholder="ABCD"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 w-full rounded-2xl border border-white/10 bg-panel px-5 py-4 text-center text-3xl font-black tracking-[0.35em] text-ink placeholder:text-white/15 focus:border-red focus:outline-none"
        />

        <label className="mt-5 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Your name
        </label>
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Name"
          maxLength={16}
          className="mt-2 w-full rounded-2xl border border-white/10 bg-panel px-5 py-4 text-lg font-bold text-ink placeholder:text-white/15 focus:border-red focus:outline-none"
        />

        {error && (
          <div className="mt-4 rounded-xl bg-red/10 px-4 py-2.5 text-sm font-semibold text-red">
            {error}
          </div>
        )}

        <button
          onClick={onJoin}
          disabled={busy}
          className="mt-6 w-full rounded-2xl bg-red px-6 py-4 text-base font-black uppercase tracking-widest text-white shadow-[0_10px_40px_-12px_rgba(230,51,28,0.9)] transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "Joining…" : "Join game"}
        </button>

        <p className="mt-4 text-center text-[11px] font-medium leading-relaxed text-muted">
          We need your microphone so you can mimic the sound.
          <br />
          Headphones make it much better.
        </p>
      </div>
    </div>
  );
}
