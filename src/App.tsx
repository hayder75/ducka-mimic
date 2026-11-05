import { lazy, Suspense } from "react";
import Play from "./pages/Play";

// The 3D stage is only ever opened by the streamer. Players joining from a
// phone or a PC load Play, which does not include three.js at all.
const Stage = lazy(() => import("./pages/Stage"));

export default function App() {
  const path = window.location.pathname;
  if (path.startsWith("/play")) return <Play />;
  return (
    <Suspense
      fallback={
        <div className="grid h-[100dvh] place-items-center bg-bg text-[11px] font-bold uppercase tracking-[0.3em] text-muted">
          Loading stage…
        </div>
      }
    >
      <Stage />
    </Suspense>
  );
}
