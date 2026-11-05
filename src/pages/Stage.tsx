import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import QRCode from "qrcode";
import Avatar from "../components/Avatar";
import Stage3D from "../components/Stage3D";
import {
  socket,
  joinUrlFor,
  type PlayerView,
  type SoundView,
  type ResultView,
} from "../lib/socket";
import {
  unlockAudio,
  loadSound,
  playSound,
  recordSamples,
  scoreAttempt,
  sfx,
  playClip,
  analyzeSamplesAsync,
  ensureMic,
  energyBars,
  type Features,
} from "../lib/audio";

type Phase = "home" | "lobby" | "demo" | "countdown" | "record" | "results";

const ACCENT = "#e6331c";

export default function Stage() {
  const [phase, setPhase] = useState<Phase>("home");
  const [code, setCode] = useState<string>("");
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [sound, setSound] = useState<SoundView | null>(null);
  const [round, setRound] = useState(0);
  const [solo, setSolo] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [progress, setProgress] = useState(0);
  const [recordMs, setRecordMs] = useState(5000);
  const [received, setReceived] = useState(0);
  const [expected, setExpected] = useState(0);
  const [results, setResults] = useState<ResultView[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState<ResultView | null>(null);
  const [qr, setQr] = useState<string>("");
  const [toast, setToast] = useState<string>("");
  const [level, setLevel] = useState(0);
  const levelsRef = useRef<Record<string, number>>({});
  const [bars, setBars] = useState<number[]>([]);

  const raf = useRef<number>(0);
  const everConnected = useRef(false);
  const revealTimers = useRef<number[]>([]);
  const soundRef = useRef<SoundView | null>(null);
  const soloRef = useRef(false);
  soloRef.current = solo;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  /* ---------------- socket wiring ---------------- */

  useEffect(() => {
    const onUpdate = (snap: any) => {
      setPlayers(snap.players || []);
      setSolo(Boolean(snap.solo));
    };
    const onNext = (p: any) => {
      setSound(p.sound);
      soundRef.current = p.sound;
      setRound(p.round);
      levelsRef.current = {};
      void loadSound(p.sound.url)
        .then(({ features }) => setBars(energyBars(features, 34)))
        .catch(() => {});
    };
    const onDemo = (p: any) => {
      setSound(p.sound);
      soundRef.current = p.sound;
      setRound(p.round);
      void loadSound(p.sound.url)
        .then(({ features }) => setBars(energyBars(features, 34)))
        .catch(() => {});
      setProgress(0);
      setPhase("demo");
      runDemo(p.sound);
    };
    const onCountdown = (p: any) => {
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
      setRecordMs(Number(p.ms) || 5000);
      setReceived(0);
      setLevel(0);
      setPhase("record");
      if (soloRef.current) void recordSolo(Number(p.ms) || 5000);
    };
    const onCollecting = (p: any) => {
      setReceived(Number(p.received) || 0);
      setExpected(Number(p.expected) || 0);
    };
    const onResults = (p: any) => {
      setResults(p.results || []);
      setPlayers(p.players || []);
      setRevealed(0);
      setPhase("results");
    };
    const onClosed = () => {
      setPhase("lobby");
      setResults([]);
      setRevealed(0);
      setSound(null);
    };
    const onRoomClosed = () => {
      showToast("Game ended.");
      setPhase("home");
      setCode("");
    };
    const onError = (p: any) => showToast(p?.message || "Something went wrong");
    const onLevel = (p: any) => {
      if (!p?.id) return;
      // mutable ref: no React re-render for every mic packet
      levelsRef.current[p.id] = Number(p.level) || 0;
    };
    const onConnect = () => {
      if (everConnected.current) window.location.reload();
      everConnected.current = true;
    };

    socket.on("room:update", onUpdate);
    socket.on("round:next", onNext);
    socket.on("round:demo", onDemo);
    socket.on("round:countdown", onCountdown);
    socket.on("round:record", onRecord);
    socket.on("round:collecting", onCollecting);
    socket.on("round:results", onResults);
    socket.on("round:closed", onClosed);
    socket.on("room:closed", onRoomClosed);
    socket.on("error:msg", onError);
    socket.on("player:level", onLevel);
    socket.on("connect", onConnect);

    return () => {
      socket.off("room:update", onUpdate);
      socket.off("round:next", onNext);
      socket.off("round:demo", onDemo);
      socket.off("round:countdown", onCountdown);
      socket.off("round:record", onRecord);
      socket.off("round:collecting", onCollecting);
      socket.off("round:results", onResults);
      socket.off("round:closed", onClosed);
      socket.off("room:closed", onRoomClosed);
      socket.off("error:msg", onError);
      socket.off("player:level", onLevel);
      socket.off("connect", onConnect);
    };
  }, [showToast]);

  /* ---------------- reveal animation ---------------- */

  useEffect(() => {
    if (phase !== "results" || !results.length) return;
    let cancelled = false;
    setRevealed(0);
    setPlaying(null);

    (async () => {
      for (let i = 0; i < results.length; i++) {
        if (cancelled) return;
        const r = results[i];
        setPlaying(r);
        if (r.audioUrl) await playClip(r.audioUrl);
        if (cancelled) return;
        setRevealed(i + 1);
        setPlaying(null);
        if (r.total >= 90) {
          sfx("win");
          burst(0.55);
        } else if (r.total < 20) {
          sfx("fail");
        } else {
          sfx("reveal");
        }
        await new Promise((res) => window.setTimeout(res, 1200));
      }
      if (!cancelled) {
        burst(1);
        sfx("win");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, results]);

  /* ---------------- actions ---------------- */

  const startGame = async () => {
    await unlockAudio();
    socket.emit("stage:create", {}, (res: any) => {
      if (!res?.ok) return showToast("Could not create game");
      setCode(res.code);
      setPhase("lobby");
      setResults([]);
      setRound(0);
    });
  };

  const startRound = async () => {
    await unlockAudio();
    socket.emit("stage:start");
  };

  const toggleSolo = async (value: boolean) => {
    await unlockAudio();
    setSolo(value);
    socket.emit("stage:solo", { enabled: value });
    if (value) {
      ensureMic().catch(() =>
        showToast("Microphone blocked. Allow mic access before recording.")
      );
    }
  };

  const runDemo = async (s: SoundView) => {
    setProgress(0);
    try {
      const { buffer } = await loadSound(s.url);
      const started = performance.now();
      const duration = buffer.duration * 1000;
      let lastPaint = 0;
      const tick = () => {
        const now = performance.now();
        const p = Math.min(1, (now - started) / duration);
        // ~14fps is plenty for the bars and keeps React out of the frame loop
        if (now - lastPaint > 70 || p >= 1) {
          setProgress(p);
          lastPaint = now;
        }
        if (p < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      await playSound(s.url);
      cancelAnimationFrame(raf.current);
      setProgress(1);
    } catch (err) {
      console.error(err);
    } finally {
      socket.emit("stage:demoDone");
    }
  };

  const recordSolo = async (ms: number) => {
    try {
      const current = soundRef.current;
      const demo = current ? (await loadSound(current.url)).features : null;
      const { samples, sampleRate } = await recordSamples(ms, setLevel);
      const attempt: Features = await analyzeSamplesAsync(samples, sampleRate);
      const scored = demo ? scoreAttempt(demo, attempt) : { score: 0, breakdown: null };
      socket.emit("player:submit", {
        score: scored.score,
        breakdown: scored.breakdown,
      });
    } catch (err) {
      console.error(err);
      showToast("Recording failed on this device.");
    }
  };

  const skip = () => socket.emit("stage:skip");
  const resetGame = () => socket.emit("stage:reset");

  /* ---------------- QR ---------------- */

  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(joinUrlFor(code), {
      margin: 1,
      width: 480,
      errorCorrectionLevel: "M",
      color: { dark: "#f2efe9ff", light: "#00000000" },
    })
      .then(setQr)
      .catch(() => setQr(""));
  }, [code]);

  /* ---------------- render ---------------- */

  const inRound = phase === "demo" || phase === "countdown" || phase === "record";
  const onStage = phase !== "home";

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-bg no-select">

      <Stage3D
        players={players}
        levels={levelsRef}
        phase={phase}
        results={results}
        revealed={revealed}
        solo={solo}
        playingId={playing?.id}
      />

      {/* readability scrim behind the HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[46%] bg-gradient-to-b from-black/85 via-black/45 to-transparent" />

      <Header round={round} phase={phase} />

      {phase === "home" && <HomeOverlay onStart={startGame} />}

      {phase === "lobby" && (
        <LobbyOverlay
          code={code}
          qr={qr}
          players={players}
          solo={solo}
          onSolo={toggleSolo}
          onStart={startRound}
          toast={toast}
        />
      )}

      {inRound && (
        <RoundHud
          phase={phase}
          sound={sound}
          progress={progress}
          countdown={countdown}
          received={received}
          expected={expected}
          bars={bars}
        />
      )}

      {phase === "results" && <ResultsHud results={results} revealed={revealed} />}

      <Footer
        phase={phase}
        onSkip={skip}
        onNext={startRound}
        onReset={resetGame}
        disabled={phase === "home" || phase === "lobby" || phase === "results"}
      />

      {toast && phase !== "lobby" && (
        <div className="absolute bottom-[12%] left-1/2 z-50 -translate-x-1/2 rounded-full bg-red px-5 py-2 text-sm font-bold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HUD                                                               */
/* ------------------------------------------------------------------ */

function Header({ round, phase }: { round: number; phase: Phase }) {
  return (
    <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 pt-5">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-red text-lg font-black text-white">
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
      <div className="text-right leading-none">
        <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted">Round</div>
        <div className="mt-1 text-2xl font-black tabular-nums">{round || "—"}</div>
      </div>
      <span className="sr-only">{phase}</span>
    </header>
  );
}

function Footer({
  phase,
  onSkip,
  onNext,
  onReset,
  disabled,
}: {
  phase: Phase;
  onSkip: () => void;
  onNext: () => void;
  onReset: () => void;
  disabled: boolean;
}) {
  return (
    <footer className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between bg-gradient-to-t from-black via-black/70 to-transparent px-6 pb-4 pt-8">
      <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        duckalabs.com
      </span>

      {phase === "results" ? (
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted backdrop-blur transition hover:border-white/25 hover:text-ink"
          >
            Reset
          </button>
          <button
            onClick={onNext}
            className="rounded-full bg-red px-5 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_6px_24px_-6px_rgba(230,51,28,0.9)] transition active:scale-[0.98]"
          >
            Next round
          </button>
        </div>
      ) : (
        !disabled && (
          <button
            onClick={onSkip}
            className="rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted backdrop-blur transition hover:border-white/25 hover:text-ink"
          >
            Skip round
          </button>
        )
      )}
    </footer>
  );
}

function HomeOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-red/30 bg-red/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.25em] text-red">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red" />
        Live game show
      </div>
      <h1 className="text-[clamp(2.6rem,9vw,5.2rem)] font-black leading-[0.9] tracking-tight">
        ሚሚክ
        <br />
        <span className="text-red">ፓርቲ</span>
      </h1>
      <p className="mt-5 max-w-sm text-sm font-medium leading-relaxed text-cream/70">
        Everyone hears the same sound. Everyone mimics it at once. One shot —
        the closest impression wins.
      </p>
      <button
        onClick={onStart}
        className="mt-9 w-full max-w-xs rounded-2xl bg-red px-8 py-4 text-base font-black uppercase tracking-widest text-white shadow-[0_10px_40px_-10px_rgba(230,51,28,0.8)] transition active:scale-[0.98]"
      >
        Start a game
      </button>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
        Players join from their phone
      </p>
    </div>
  );
}

function LobbyOverlay({
  code,
  qr,
  players,
  solo,
  onSolo,
  onStart,
  toast,
}: {
  code: string;
  qr: string;
  players: PlayerView[];
  solo: boolean;
  onSolo: (v: boolean) => void;
  onStart: () => void;
  toast: string;
}) {
  return (
    <div className="absolute inset-x-0 top-[7%] z-20 flex flex-col items-center px-6">
      <div className="grid w-full max-w-2xl grid-cols-[1fr_auto] items-center gap-6">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-muted">
            Room code
          </div>
          <div className="mt-1 text-[clamp(3rem,10vw,5.5rem)] font-black leading-none tracking-[0.08em] text-ink">
            {code}
          </div>
          <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-cream/50">
            {joinUrlFor(code).replace(/^https?:\/\//, "")}
          </div>
        </div>
        <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
          {qr ? (
            <img src={qr} alt="Join QR" className="h-24 w-24 sm:h-32 sm:w-32" />
          ) : (
            <div className="h-24 w-24 animate-pulse rounded bg-white/5 sm:h-32 sm:w-32" />
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {players.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-bold ring-1 ring-white/10"
          >
            <Avatar
              slot={p.avatarSlot}
              emoji={p.avatar}
              className="h-5 w-5"
              emojiClassName="text-sm"
            />
            <span className="max-w-[90px] truncate">{p.name}</span>
          </div>
        ))}
        {!players.length && (
          <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-muted">
            Waiting for players…
          </span>
        )}
      </div>

      <button
        onClick={onStart}
        disabled={!players.length && !solo}
        className="mt-6 w-full max-w-xs rounded-2xl bg-red px-8 py-3.5 text-sm font-black uppercase tracking-widest text-white shadow-[0_10px_40px_-10px_rgba(230,51,28,0.8)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
      >
        Start round
      </button>

      <button
        onClick={() => onSolo(!solo)}
        className={`mt-3 flex items-center gap-2 rounded-full border px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest transition ${
          solo
            ? "border-red bg-red/15 text-red"
            : "border-white/10 text-muted hover:border-white/25"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${solo ? "bg-red" : "bg-white/20"}`} />
        Play solo on this device
      </button>

      {toast && (
        <div className="mt-3 rounded-full bg-red/90 px-4 py-1.5 text-xs font-bold text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

function RoundHud({
  phase,
  sound,
  progress,
  countdown,
  received,
  expected,
  bars,
}: {
  phase: Phase;
  sound: SoundView | null;
  progress: number;
  countdown: number;
  received: number;
  expected: number;
  bars: number[];
}) {
  const count = bars.length || 34;
  const heights = bars.length
    ? bars
    : Array.from(
        { length: count },
        (_, i) => 0.25 + (Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.7
      );

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[8%] z-20 flex flex-col items-center px-6 text-center">
      <div className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-cream/60">
        {phase === "demo"
          ? "Listen carefully"
          : phase === "countdown"
          ? "Get ready"
          : "Mimic now"}
      </div>

      <h2 className="mt-4 max-w-lg text-[clamp(1.4rem,4vw,2.4rem)] font-black leading-tight">
        {sound?.title || "…"}
      </h2>

      <div className="mt-4 flex h-16 w-full max-w-xl items-center justify-center gap-[3px]">
        {heights.map((h, i) => {
          const active = i / count <= progress;
          return (
            <div
              key={i}
              className={`w-full max-w-[9px] rounded-full transition-all duration-150 ${
                active ? "bg-red" : "bg-white/10"
              } ${phase === "countdown" ? "opacity-25" : ""}`}
              style={{ height: `${12 + h * 82}%` }}
            />
          );
        })}
      </div>

      {phase === "countdown" && (
        <div className="mt-1 animate-pop text-[clamp(4rem,14vh,9rem)] font-black leading-none text-red drop-shadow-[0_0_40px_rgba(230,51,28,0.45)]">
          {countdown > 0 ? countdown : "GO!"}
        </div>
      )}

      {phase === "record" && (
        <div className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-red">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red" />
          {expected > 0 ? `${received} / ${expected} submitted` : "Recording"}
        </div>
      )}
    </div>
  );
}

function ResultsHud({
  results,
  revealed,
}: {
  results: ResultView[];
  revealed: number;
}) {
  const all = results.length > 0 && revealed >= results.length;
  const current = revealed > 0 ? results[revealed - 1] : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[17%] z-20 flex flex-col items-center px-6 text-center">
      {!current ? (
        <>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
            Scores
          </div>
          <div className="mt-1 text-[clamp(3rem,10vh,6rem)] font-black text-white/15">?</div>
        </>
      ) : (
        <>
          {all && (
            <div className="animate-pop rounded-full bg-gold px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-black">
              Round winner
            </div>
          )}
          <div className={`flex items-center gap-2 text-lg font-bold ${all ? "mt-2" : ""}`}>
            <Avatar
              slot={current.avatarSlot}
              emoji={current.avatar}
              className="h-7 w-7"
              emojiClassName="text-xl"
            />
            {current.name}
          </div>
          <div
            className="animate-pop text-[clamp(3rem,12vh,7.4rem)] font-black leading-none tabular-nums"
            style={{ color: current.total >= 90 ? "#ffc247" : "#f2efe9" }}
          >
            {current.total}
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
            <span>of 100</span>
            {current.bonus > 0 && (
              <span className="rounded-full bg-gold/20 px-2 py-0.5 text-gold">
                bonus +{current.bonus}
              </span>
            )}
          </div>

        </>
      )}
    </div>
  );
}

function burst(scale = 1) {
  confetti({
    particleCount: Math.round(90 * scale),
    spread: 80,
    startVelocity: 42,
    origin: { y: 0.62 },
    colors: [ACCENT, "#ffc247", "#f2efe9", "#ff7a5c"],
    disableForReducedMotion: true,
  });
}
