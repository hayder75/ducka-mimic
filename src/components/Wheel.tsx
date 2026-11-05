import { useEffect, useRef, useState } from "react";

export type WheelData = {
  index: number;
  segment: { kind: string; value?: number | string; label: string };
  player: { id: string; name: string; avatar: string; avatarSlot?: number } | null;
};

const SEGMENTS = [
  { label: "+20", color: "#7a1a10" },
  { label: "DOUBLE", color: "#2a1a12" },
  { label: "ECHO", color: "#7a1a10" },
  { label: "FART", color: "#2a1a12" },
  { label: "+30", color: "#7a1a10" },
  { label: "CHOP", color: "#2a1a12" },
  { label: "PITCH", color: "#7a1a10" },
  { label: "NOTHING", color: "#2a1a12" },
];

export default function Wheel({
  data,
  onClose,
}: {
  data: WheelData;
  onClose: () => void;
}) {
  const [angle, setAngle] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const seg = 360 / SEGMENTS.length;
    const target = 360 * 6 - (data.index * seg + seg / 2);
    const t = window.setTimeout(() => setAngle(target), 120);
    const t2 = window.setTimeout(() => setShowResult(true), 2900);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [data.index]);

  const label = data.segment.label;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        Wheel of chaos
      </div>

      <div className="relative mt-6 h-[290px] w-[290px]">
        {/* pointer */}
        <div className="absolute -top-2 left-1/2 z-20 -translate-x-1/2">
          <div className="h-0 w-0 border-x-[10px] border-t-[16px] border-x-transparent border-t-red drop-shadow" />
        </div>

        <div
          className="h-full w-full rounded-full border-4 border-black/60 shadow-[0_0_60px_rgba(230,51,28,0.35)] transition-transform duration-[2800ms] ease-[cubic-bezier(.12,.75,.08,1)]"
          style={{
            transform: `rotate(${angle}deg)`,
            background: `conic-gradient(${SEGMENTS.map(
              (s, i) =>
                `${s.color} ${(i * 360) / SEGMENTS.length}deg ${
                  ((i + 1) * 360) / SEGMENTS.length
                }deg`
            ).join(",")})`,
          }}
        >
          {SEGMENTS.map((s, i) => {
            const a = (i * 360) / SEGMENTS.length + 360 / SEGMENTS.length / 2;
            return (
              <span
                key={i}
                className="absolute left-1/2 top-1/2 text-center text-[9px] font-black uppercase tracking-wider text-cream/90"
                style={{
                  width: 76,
                  marginLeft: -38,
                  marginTop: -6,
                  transform: `rotate(${a}deg) translateY(-104px)`,
                }}
              >
                {s.label}
              </span>
            );
          })}
        </div>

        <div className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-black/60 bg-red text-2xl">
          🎡
        </div>
      </div>

      <div className="mt-8 h-24 text-center">
        {showResult && (
          <div className="animate-pop">
            <div className="text-2xl font-black">{label}</div>
            {data.player ? (
              <div className="mt-1 text-sm font-semibold text-cream/80">
                {data.player.name} is affected next round
              </div>
            ) : (
              <div className="mt-1 text-sm font-semibold text-cream/80">
                No effect this time
              </div>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        disabled={!showResult}
        className="mt-2 rounded-2xl bg-red px-8 py-3 text-sm font-black uppercase tracking-widest text-white transition active:scale-[0.98] disabled:bg-white/10 disabled:text-white/30"
      >
        Back to the stage
      </button>
    </div>
  );
}
