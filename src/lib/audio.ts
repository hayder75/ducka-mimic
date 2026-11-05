/* Audio engine: demo playback, mic capture, feature extraction, scoring. */

const ANALYSIS_SR = 8000;
const FRAME = 512;
const HOP = 256;

export type Features = {
  /** fundamental frequency per frame in Hz (0 = unvoiced) */
  pitch: number[];
  /** rms per frame */
  energy: number[];
  /** frame is voiced */
  voiced: boolean[];
  /** number of distinct attacks / hits */
  onsets: number;
  durationMs: number;
  sampleRate: number;
};

export type Breakdown = {
  pitch: number;
  rhythm: number;
  sustain: number;
  attacks: number;
  heardNote: string;
};

export type ScoreResult = {
  score: number;
  breakdown: Breakdown;
};

/* ------------------------------------------------------------------ */
/*  Context + unlock                                                   */
/* ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

export async function unlockAudio(): Promise<void> {
  const c = audioContext();
  if (c.state === "suspended") await c.resume();
}

/* ------------------------------------------------------------------ */
/*  Microphone                                                         */
/* ------------------------------------------------------------------ */

let micStream: MediaStream | null = null;

export async function ensureMic(): Promise<MediaStream> {
  if (micStream && micStream.getAudioTracks().some((t) => t.readyState === "live")) {
    return micStream;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot access the microphone.");
  }
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  return micStream;
}

export function hasMic(): boolean {
  return Boolean(micStream && micStream.getAudioTracks().some((t) => t.readyState === "live"));
}

export async function recordSamples(
  ms: number,
  onLevel?: (level: number) => void
): Promise<{ samples: Float32Array; sampleRate: number; blob: Blob | null }> {
  const stream = await ensureMic();
  const c = audioContext();
  if (c.state === "suspended") await c.resume();

  const source = c.createMediaStreamSource(stream);
  const processor = c.createScriptProcessor(1024, 1, 1);
  const sink = c.createGain();
  sink.gain.value = 0;

  const chunks: Float32Array[] = [];
  let stopped = false;

  let recorder: MediaRecorder | null = null;
  let clip: Promise<Blob | null> = Promise.resolve(null);
  if (typeof MediaRecorder !== "undefined") {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    const mime = types.find((t) => {
      try {
        return MediaRecorder.isTypeSupported(t);
      } catch {
        return false;
      }
    });
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const parts: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) parts.push(e.data);
      };
      clip = new Promise((resolve) => {
        if (!recorder) return resolve(null);
        recorder.onstop = () =>
          resolve(new Blob(parts, { type: recorder?.mimeType || "audio/webm" }));
        recorder.onerror = () => resolve(null);
      });
      recorder.start();
    } catch {
      recorder = null;
    }
  }

  processor.onaudioprocess = (ev) => {
    if (stopped) return;
    const input = ev.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    chunks.push(copy);

    if (onLevel) {
      let sum = 0;
      for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
      onLevel(Math.min(1, Math.sqrt(sum / copy.length) * 6));
    }
  };

  source.connect(processor);
  processor.connect(sink);
  sink.connect(c.destination);

  await new Promise((r) => setTimeout(r, ms));

  stopped = true;
  processor.onaudioprocess = null;
  try {
    source.disconnect();
    processor.disconnect();
    sink.disconnect();
  } catch {
    /* already disconnected */
  }
  onLevel?.(0);

  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
  }

  const total = chunks.reduce((n, ch) => n + ch.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const ch of chunks) {
    samples.set(ch, offset);
    offset += ch.length;
  }
  return { samples, sampleRate: c.sampleRate, blob: await clip };
}

/* ------------------------------------------------------------------ */
/*  Sound loading + playback                                          */
/* ------------------------------------------------------------------ */

export type LoadedSound = { buffer: AudioBuffer; features: Features };

const cache = new Map<string, Promise<LoadedSound>>();

export function loadSound(url: string): Promise<LoadedSound> {
  const existing = cache.get(url);
  if (existing) return existing;

  const job = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url}`);
    const arr = await res.arrayBuffer();
    const c = audioContext();
    const buffer = await c.decodeAudioData(arr.slice(0));
    const features = analyzeSamples(mixToMono(buffer), buffer.sampleRate);
    return { buffer, features };
  })();

  cache.set(url, job);
  job.catch(() => cache.delete(url));
  return job;
}

export async function playSound(url: string): Promise<void> {
  const c = audioContext();
  if (c.state === "suspended") await c.resume();
  const { buffer } = await loadSound(url);
  await new Promise<void>((resolve) => {
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    source.onended = () => resolve();
    source.start();
  });
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) out[i] = (left[i] + right[i]) / 2;
  return out;
}

/** Play an uploaded take through the unlocked AudioContext. */
export async function playClip(
  url: string,
  effect?: string | null,
  maxMs = 9000
): Promise<void> {
  const c = audioContext();
  if (c.state === "suspended") await c.resume();

  if (effect === "fart") {
    fart();
    await new Promise((r) => setTimeout(r, 900));
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.arrayBuffer();
    const buffer = await c.decodeAudioData(data);
    const now = c.currentTime;

    await new Promise<void>((resolve) => {
      if (effect === "chop") {
        const dur = Math.min(buffer.duration, 6);
        for (let t = 0; t < dur; t += 0.24) {
          const src = c.createBufferSource();
          src.buffer = buffer;
          src.connect(c.destination);
          src.start(now + t, t, 0.12);
        }
        setTimeout(resolve, dur * 1000 + 200);
        return;
      }

      const src = c.createBufferSource();
      src.buffer = buffer;
      if (effect === "pitch") src.playbackRate.value = 1.45;

      if (effect === "echo") {
        const delay = c.createDelay(0.5);
        delay.delayTime.value = 0.18;
        const fb = c.createGain();
        fb.gain.value = 0.38;
        src.connect(c.destination);
        src.connect(delay);
        delay.connect(fb);
        fb.connect(delay);
        delay.connect(c.destination);
      } else {
        src.connect(c.destination);
      }

      src.onended = () => resolve();
      src.start();
      window.setTimeout(resolve, maxMs);
    });
  } catch {
    /* a broken take should never block the reveal */
  }
}

/** Synthesized fart, for the sabotage. */
export function fart(): void {
  const c = audioContext();
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.55);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.7);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.95);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + 1.05);
}

/* ------------------------------------------------------------------ */
/*  Analysis                                                          */
/* ------------------------------------------------------------------ */

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from <= to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function detectPitch(frame: Float32Array, sr: number): number {
  const n = frame.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n;

  let rms = 0;
  for (let i = 0; i < n; i++) {
    const v = frame[i] - mean;
    rms += v * v;
  }
  rms = Math.sqrt(rms / n);
  if (rms < 0.01) return 0;

  const minLag = Math.max(2, Math.floor(sr / 600));
  const maxLag = Math.min(n - 2, Math.floor(sr / 70));
  let bestLag = -1;
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let e1 = 0;
    let e2 = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      const a = frame[i] - mean;
      const b = frame[i + lag] - mean;
      corr += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const norm = corr / Math.sqrt(e1 * e2 + 1e-9);
    if (norm > bestScore) {
      bestScore = norm;
      bestLag = lag;
    }
  }

  if (bestScore < 0.42 || bestLag < 0) return 0;
  return sr / bestLag;
}

function analyseFrame(frame: Float32Array) {
  let sum = 0;
  for (let j = 0; j < frame.length; j++) sum += frame[j] * frame[j];
  const rms = Math.sqrt(sum / frame.length);
  const f0 = detectPitch(frame, ANALYSIS_SR);
  return { f0, rms, voiced: f0 > 0 && rms > 0.008 };
}

function finalize(
  rawPitch: number[],
  rawEnergy: number[],
  rawVoiced: boolean[]
): Features {
  // trim leading/trailing silence so timing comparisons line up
  let start = 0;
  let end = rawEnergy.length - 1;
  const quiet = (i: number) => rawEnergy[i] < 0.007 && !rawVoiced[i];
  while (start < end && quiet(start)) start++;
  while (end > start && quiet(end)) end--;

  const pitch = rawPitch.slice(start, end + 1);
  const energy = rawEnergy.slice(start, end + 1);
  const voiced = rawVoiced.slice(start, end + 1);

  // count attacks: a sharp rise after a quiet gap, at least 3 frames apart
  let onsets = 0;
  let lastOnset = -99;
  for (let i = 1; i < energy.length; i++) {
    const prev = energy[i - 1];
    const cur = energy[i];
    if (cur > 0.05 && cur > prev * 1.5 && i - lastOnset > 3) {
      onsets += 1;
      lastOnset = i;
    }
  }

  return {
    pitch,
    energy,
    voiced,
    onsets,
    durationMs: (energy.length * HOP * 1000) / ANALYSIS_SR,
    sampleRate: ANALYSIS_SR,
  };
}

export function analyzeSamples(mono: Float32Array, sampleRate: number): Features {
  const ds = downsample(mono, sampleRate, ANALYSIS_SR);
  const rawPitch: number[] = [];
  const rawEnergy: number[] = [];
  const rawVoiced: boolean[] = [];

  for (let i = 0; i + FRAME <= ds.length; i += HOP) {
    const { f0, rms, voiced } = analyseFrame(ds.subarray(i, i + FRAME));
    rawPitch.push(f0);
    rawEnergy.push(rms);
    rawVoiced.push(voiced);
  }

  return finalize(rawPitch, rawEnergy, rawVoiced);
}

/**
 * Same result, but yields to the browser every few frames so the UI (and the
 * 3D scene) keeps painting while a phone analyses a 5 second take.
 */
export async function analyzeSamplesAsync(
  mono: Float32Array,
  sampleRate: number
): Promise<Features> {
  const ds = downsample(mono, sampleRate, ANALYSIS_SR);
  const rawPitch: number[] = [];
  const rawEnergy: number[] = [];
  const rawVoiced: boolean[] = [];
  let processed = 0;

  for (let i = 0; i + FRAME <= ds.length; i += HOP) {
    const { f0, rms, voiced } = analyseFrame(ds.subarray(i, i + FRAME));
    rawPitch.push(f0);
    rawEnergy.push(rms);
    rawVoiced.push(voiced);

    processed += 1;
    if (processed % 12 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return finalize(rawPitch, rawEnergy, rawVoiced);
}

/* ------------------------------------------------------------------ */
/*  Scoring                                                           */
/* ------------------------------------------------------------------ */

function resample(values: number[], n: number): number[] {
  if (!values.length) return new Array(n).fill(0);
  if (values.length === 1) return new Array(n).fill(values[0]);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(values.length - 1, lo + 1);
    const f = t - lo;
    out.push(values[lo] * (1 - f) + values[hi] * f);
  }
  return out;
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da < 1e-9 || db < 1e-9) return 0;
  return num / Math.sqrt(da * db);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function voicedCount(f: Features): number {
  return f.voiced.filter(Boolean).length;
}

export function scoreAttempt(demo: Features, attempt: Features): ScoreResult {
  const attemptVoiced = voicedCount(attempt);
  const demoVoiced = Math.max(1, voicedCount(demo));

  if (attemptVoiced < 3) {
    return {
      score: 0,
      breakdown: { pitch: 0, rhythm: 0, sustain: 0, attacks: 0, heardNote: "ምንም አልሰማንም" },
    };
  }

  // pitch contour in semitones relative to each performer's own median pitch
  const demoPitch = demo.pitch.filter((p) => p > 0).map((p) => 12 * Math.log2(p / 440));
  const attemptPitch = attempt.pitch.filter((p) => p > 0).map((p) => 12 * Math.log2(p / 440));

  let pitchCorr = 0;
  if (demoPitch.length >= 4 && attemptPitch.length >= 4) {
    // compare intervals relative to each performer's opening note, so a
    // different voice pitch is fine but wrong notes are not
    const dRef = median(demoPitch.slice(0, Math.max(3, Math.floor(demoPitch.length * 0.1))));
    const aRef = median(attemptPitch.slice(0, Math.max(3, Math.floor(attemptPitch.length * 0.1))));
    const dContour = resample(demoPitch.map((v) => v - dRef), 48);
    const aContour = resample(attemptPitch.map((v) => v - aRef), 48);

    const variance = (arr: number[]) => {
      const m = arr.reduce((s, v) => s + v, 0) / arr.length;
      return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
    };
    const dv = variance(dContour);
    const av = variance(aContour);
    if (dv < 0.02 && av < 0.02) {
      pitchCorr = 1; // both are a steady note
    } else if (dv < 0.02 || av < 0.02) {
      pitchCorr = 0.25; // one is flat, the other moves
    } else {
      const corr = correlation(dContour, aContour);
      let mad = 0;
      for (let i = 0; i < dContour.length; i++) {
        mad += Math.abs(dContour[i] - aContour[i]);
      }
      mad /= dContour.length;
      // correlation rewards the shape, the error term punishes wrong intervals
      pitchCorr = Math.max(0, corr) * Math.exp(-mad / 6);
    }
  }

  const dEnergy = resample(demo.energy, 48);
  const aEnergy = resample(attempt.energy, 48);
  const maxD = Math.max(1e-6, ...dEnergy);
  const maxA = Math.max(1e-6, ...aEnergy);
  const rhythmCorr = correlation(
    dEnergy.map((v) => v / maxD),
    aEnergy.map((v) => v / maxA)
  );

  const sustain = Math.min(1, attemptVoiced / demoVoiced);
  const attacks =
    demo.onsets === 0
      ? 1
      : Math.max(0, 1 - Math.abs(demo.onsets - attempt.onsets) / demo.onsets);

  const p = Math.max(0, pitchCorr);
  const r = Math.max(0, rhythmCorr);
  const raw = 0.5 * p + 0.2 * r + 0.15 * sustain + 0.15 * attacks;
  let score = Math.round(96 * Math.pow(raw, 0.85));

  if (attemptVoiced < Math.max(3, demoVoiced * 0.15)) score = Math.min(score, 12);
  score = Math.max(0, Math.min(100, score));

  const heardNote =
    score >= 90
      ? "WOW! በጣም ቅርብ!"
      : score >= 70
      ? "ጥሩ ነው!"
      : score >= 40
      ? "ከመንገድ ላይ ነው"
      : "ደግመህ ሞክር";

  return {
    score,
    breakdown: {
      pitch: Math.round(100 * p),
      rhythm: Math.round(100 * r),
      sustain: Math.round(100 * sustain),
      attacks: Math.round(100 * attacks),
      heardNote,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Waveform bars                                                     */
/* ------------------------------------------------------------------ */

export function energyBars(features: Features, count = 32): number[] {
  const source = features.energy;
  if (!source.length) return new Array(count).fill(0.25);
  const peak = Math.max(1e-6, ...source);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i / count) * source.length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / count) * source.length));
    let sum = 0;
    for (let j = start; j < end && j < source.length; j++) sum += source[j];
    out.push(Math.min(1, sum / (end - start) / peak));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  UI sound effects (synthesized, no assets)                         */
/* ------------------------------------------------------------------ */

type SfxName = "tick" | "go" | "reveal" | "win" | "fail";
export function sfx(name: SfxName): void {
  const c = audioContext();
  if (c.state === "suspended") void c.resume();
  const now = c.currentTime;

  const tone = (
    freq: number,
    start: number,
    duration: number,
    type: OscillatorType = "sine",
    gainValue = 0.15,
    slideTo?: number
  ) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now + start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + start + duration);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now + start);
    osc.stop(now + start + duration + 0.02);
  };

  switch (name) {
    case "tick":
      tone(720, 0, 0.07, "square", 0.08);
      break;
    case "go":
      tone(880, 0, 0.12, "square", 0.12, 1320);
      break;
    case "reveal":
      tone(520, 0, 0.09, "triangle", 0.1);
      tone(780, 0.06, 0.12, "triangle", 0.08);
      break;
    case "win":
      tone(660, 0, 0.12, "triangle", 0.12);
      tone(880, 0.1, 0.12, "triangle", 0.12);
      tone(1100, 0.2, 0.22, "triangle", 0.12);
      break;
    case "fail":
      tone(300, 0, 0.3, "sawtooth", 0.08, 120);
      break;
  }
}
