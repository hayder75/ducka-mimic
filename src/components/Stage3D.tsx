import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { PlayerView, ResultView } from "../lib/socket";

type Phase = "home" | "lobby" | "demo" | "countdown" | "record" | "results";

type Actor = {
  id: string;
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  current: string;
  after: string | null;
  scale: number;
  idle: THREE.Vector3;
  target: THREE.Vector3;
};

const MIC = new THREE.Vector3(0, 0, 0.28);
const THEMES = [
  { main: 0x7fb84a, stripe: 0x3f6b2e },
  { main: 0x5aa8c8, stripe: 0x2f5f75 },
  { main: 0xc88a5a, stripe: 0x75492f },
  { main: 0xb86fb0, stripe: 0x6b3964 },
  { main: 0xc9b25a, stripe: 0x76672f },
  { main: 0x6fc86f, stripe: 0x397539 },
  { main: 0xc86f6f, stripe: 0x753939 },
  { main: 0x8a8ac8, stripe: 0x4a4a75 },
];

export default function Stage3D({
  players,
  levels,
  phase,
  results,
  revealed,
  solo,
  compact = false,
  meId,
  playingId,
  teamMode = false,
}: {
  players: PlayerView[];
  levels: React.MutableRefObject<Record<string, number>>;
  phase: Phase;
  results: ResultView[];
  revealed: number;
  solo: boolean;
  compact?: boolean;
  meId?: string;
  playingId?: string;
  teamMode?: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());

  const state = useRef({ players, levels, phase, results, revealed, solo, playingId });
  state.current = { players, levels, phase, results, revealed, solo, playingId };

  const actors = useRef(new Map<string, Actor>());
  const template = useRef<THREE.Object3D | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const lastRevealed = useRef(0);

  /* ------------------------------------------------------------------ */
  /*  Three scene (created once)                                         */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const el = mount.current!;
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.fog = new THREE.FogExp2(0x060405, 0.05);

    const camera = new THREE.PerspectiveCamera(
      33,
      el.clientWidth / el.clientHeight,
      0.1,
      120
    );
    camera.position.set(0, 1.7, 8.2);
    cameraRef.current = camera;
    camera.lookAt(0, 1.55, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    const size = { w: el.clientWidth, h: el.clientHeight };
    sizeRef.current = size;
    const dprFor = (w: number, h: number) => {
      const maxPixels = compact ? 1_600_000 : 3_500_000;
      const byPixels = Math.sqrt(maxPixels / Math.max(1, w * h));
      const cap = compact ? 1.3 : 1.75;
      return Math.max(1, Math.min(window.devicePixelRatio || 1, byPixels, cap));
    };
    renderer.setSize(size.w, size.h);
    renderer.setPixelRatio(dprFor(size.w, size.h));
    renderer.shadowMap.enabled = !compact;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    el.appendChild(renderer.domElement);

    /* ---------------- set ---------------- */

    const roomFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({
        color: 0x0a0706,
        roughness: 0.92,
        metalness: 0.06,
      })
    );
    roomFloor.rotation.x = -Math.PI / 2;
    roomFloor.position.y = -0.2;
    roomFloor.receiveShadow = true;
    scene.add(roomFloor);

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.5, 0.18, 64),
      new THREE.MeshStandardMaterial({
        color: 0x2b1a12,
        roughness: 0.55,
        metalness: 0.15,
      })
    );
    disc.position.y = -0.09;
    disc.receiveShadow = true;
    scene.add(disc);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(3.46, 0.035, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0xff3b1e })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;
    scene.add(rim);

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 20),
      new THREE.MeshStandardMaterial({ color: 0x140b10, roughness: 1 })
    );
    wall.position.set(0, 5, -6);
    scene.add(wall);

    for (const side of [-1, 1]) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 1.6, 0.55),
        new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 0.85 })
      );
      box.position.set(side * 2.6, 0.8, -1.5);
      box.castShadow = true;
      scene.add(box);
      for (const y of [0.5, 1.2]) {
        const cone = new THREE.Mesh(
          new THREE.CircleGeometry(0.19, 24),
          new THREE.MeshStandardMaterial({ color: 0x0a0807, roughness: 1 })
        );
        cone.position.set(side * 2.6, y, -1.22);
        scene.add(cone);
      }
    }

    // mic stand
    const micGroup = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.05, 12),
      new THREE.MeshStandardMaterial({
        color: 0x2a2a28,
        roughness: 0.5,
        metalness: 0.5,
      })
    );
    pole.position.y = 0.52;
    const head = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.075, 0.1, 6, 12),
      new THREE.MeshStandardMaterial({
        color: 0x3a3a37,
        roughness: 0.4,
        metalness: 0.35,
      })
    );
    head.position.y = 1.14;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.24, 0.04, 24),
      new THREE.MeshStandardMaterial({ color: 0x232321, roughness: 0.7 })
    );
    base.position.y = 0.02;
    micGroup.add(pole, head, base);
    micGroup.position.set(0, 0, 0.62);
    scene.add(micGroup);

    // mic glow
    const micGlow = new THREE.PointLight(0xe6331c, 0, 3.2, 2);
    micGlow.position.set(0, 1.1, 0.62);
    scene.add(micGlow);

    /* ---------------- lights ---------------- */

    scene.add(new THREE.HemisphereLight(0x8899ff, 0x1a0f0a, 0.65));

    const key = new THREE.SpotLight(0xffe7cf, 200, 18, 0.55, 0.45, 1.8);
    key.position.set(1.8, 6.5, 3.6);
    key.target.position.set(0, 0.8, 0);
    key.castShadow = !compact;
    key.shadow.mapSize.set(512, 512);
    key.shadow.bias = -0.0005;
    scene.add(key, key.target);

    const red = new THREE.SpotLight(0xff3b1e, 110, 14, 0.7, 0.6, 1.8);
    red.position.set(-3.2, 3.4, -1);
    red.target.position.set(0, 0.8, 0);
    scene.add(red, red.target);

    const blue = new THREE.SpotLight(0x5b6cff, 70, 14, 0.7, 0.6, 1.8);
    blue.position.set(3.2, 3.2, -1);
    blue.target.position.set(0, 0.8, 0);
    scene.add(blue, blue.target);

    for (const [x, color] of [
      [-1.8, 0xffd9b0],
      [0, 0xfff1dd],
      [1.8, 0xffd9b0],
    ] as const) {
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(0.8, 5.6, 32, 1, true),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.05,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      beam.position.set(x, 3.5, 0.4);
      scene.add(beam);
    }

    /* ---------------- load model ---------------- */

    let disposed = false;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      "/models/alien.glb",
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        (model as any).animations = gltf.animations;
        prepare(model);
        template.current = model;
        syncActors();
        setReady(true);
      },
      (ev) => {
        if (ev.total) setLoadPct(Math.min(1, ev.loaded / ev.total));
      },
      (err) => console.error("[3d] model failed", err)
    );

    /* ---------------- loop ---------------- */

    const clock = new THREE.Clock();
    let raf = 0;
    const projected = new THREE.Vector3();
    let frames = 0;
    let elapsed = 0;
    let degraded = false;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.getElapsedTime();
      const s = state.current;

      // auto-quality: drop resolution + shadows if the machine is struggling
      frames += 1;
      elapsed += dt;
      if (!degraded && elapsed > 3) {
        const fps = frames / elapsed;
        if (fps < 40) {
          degraded = true;
          renderer.setPixelRatio(1);
          renderer.shadowMap.enabled = false;
          key.castShadow = false;
        }
        frames = 0;
        elapsed = 0;
      }

      camera.position.x = Math.sin(t * 0.22) * 0.05;
      camera.lookAt(0, 1.55, 0);

      micGlow.intensity = s.phase === "record" ? 7 + Math.sin(t * 6) * 2 : 0;
      rim.material.color.setHex(s.phase === "record" ? 0xff5a33 : 0xff3b1e);

      // reveal edge
      if (s.revealed !== lastRevealed.current) {
        if (s.revealed > lastRevealed.current) {
          const r = s.results[s.revealed - 1];
          const actor = r ? actors.current.get(r.id) : null;
          const isWinner =
            s.revealed === s.results.length &&
            r?.id === s.results[s.results.length - 1]?.id;
          if (r && actor) celebrate(actor, r, isWinner);
        }
        lastRevealed.current = s.revealed;
      }
      if (s.phase !== "results" && lastRevealed.current !== 0) {
        lastRevealed.current = 0;
      }

      const count = s.players.length;
      for (const [i, p] of s.players.entries()) {
        const actor = actors.current.get(p.id);
        if (!actor) continue;

        const spot = idleSpot(i, count, s.solo);
        const recording = s.phase === "record";
        const replaying = s.playingId === p.id;
        const toMic = (recording || replaying) && count === 1;
        const forward = recording || (replaying && count > 1);

        actor.target.copy(spot);
        if (toMic) actor.target.copy(MIC);
        // stay at the mic for the solo reveal
        if (count === 1 && s.phase === "results") actor.target.copy(MIC);
        if (forward) actor.target.z += 0.55;
        if (replaying) actor.group.scale.setScalar(actor.scale * 1.04);

        const phaseScale =
          s.phase === "lobby" || s.phase === "home" ? 0.86 : 1;
        if (!replaying) actor.group.scale.setScalar(actor.scale * phaseScale);

        const dist = actor.group.position.distanceTo(actor.target);
        actor.group.position.lerp(actor.target, 1 - Math.pow(0.02, dt));
        actor.group.rotation.y = 0;

        // animation choice
        const moving = dist > 0.08 && (toMic || forward);
        if (moving) {
          play(actor, "Walk");
        } else if (actor.current === "Walk") {
          play(actor, "Idle");
          actor.after = null;
        }

        // speech bounce
        const lvl = s.levels.current[p.id] ?? 0;
        if (recording && lvl > 0.05) {
          actor.group.position.y = Math.sin(t * 14) * 0.02 * lvl;
        } else {
          actor.group.position.y = 0;
        }

        actor.mixer.update(dt);

        // project label
        projected
          .set(
            actor.group.position.x,
            2.05 * actor.scale + 0.15,
            actor.group.position.z
          )
          .project(camera);
        const el = labelRefs.current.get(p.id);
        if (el) {
          const x = (projected.x * 0.5 + 0.5) * size.w;
          const y = (-projected.y * 0.5 + 0.5) * size.h;
          el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
          el.style.opacity = projected.z > 1 ? "0" : "1";
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    /* ---------------- resize ---------------- */

    const onResize = () => {
      size.w = el.clientWidth;
      size.h = el.clientHeight;
      camera.aspect = size.w / size.h;
      camera.updateProjectionMatrix();
      renderer.setSize(size.w, size.h);
      if (!degraded) renderer.setPixelRatio(dprFor(size.w, size.h));
      cameraFor(state.current.players.length);
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (renderer.domElement.parentElement === el) {
        el.removeChild(renderer.domElement);
      }
      actors.current.forEach((a) => scene.remove(a.group));
      actors.current.clear();
      template.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Keep actors in sync with players                                   */
  /* ------------------------------------------------------------------ */

  function cameraFor(count: number) {
    const cam = cameraRef.current;
    if (!cam) return;
    const aspect = sizeRef.current.w / Math.max(1, sizeRef.current.h);
    const maxX = count <= 1 ? 0.85 : Math.min(1.9, 0.55 + count * 0.18);
    const halfFov = Math.tan((33 * Math.PI) / 180 / 2);
    const fit = (maxX + 0.62) / (halfFov * Math.max(0.36, aspect));
    const target = Math.max(7.2, fit + 0.35);
    cam.position.z += (target - cam.position.z) * 0.6;
    cam.updateProjectionMatrix();
  }

  function syncActors() {
    const base = template.current;
    const scene = sceneRef.current;
    if (!base || !scene) return;

    const wanted = new Set(state.current.players.map((p) => p.id));
    for (const [id, actor] of actors.current) {
      if (!wanted.has(id)) {
        scene.remove(actor.group);
        actors.current.delete(id);
      }
    }

    state.current.players.forEach((p, i) => {
      if (actors.current.has(p.id)) return;

      const clone = SkeletonUtils.clone(base) as THREE.Object3D;
      const theme = THEMES[i % THEMES.length];
      clone.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const built = mats.map((old: any) => {
          const name = old?.name || "";
          const color = name.includes("Stripe")
            ? theme.stripe
            : name.includes("Eyes") || name.includes("White")
            ? 0xe8e2d6
            : name.includes("Nails")
            ? 0x1c1c1a
            : theme.main;
          return new THREE.MeshStandardMaterial({
            color,
            roughness: name.includes("Eyes") ? 0.25 : 0.72,
            metalness: 0.04,
          });
        });
        m.material = Array.isArray(m.material) ? built : built[0];
      });

      const mixer = new THREE.AnimationMixer(clone);
      const actions: Record<string, THREE.AnimationAction> = {};
      for (const clip of (base as any).animations as THREE.AnimationClip[]) {
        const name = (clip.name.split("|").pop() || clip.name).replace(/^Alien_/, "");
        actions[name] = mixer.clipAction(clip);
      }

      const group = new THREE.Group();
      group.add(clone);
      const spot = idleSpot(i, state.current.players.length, state.current.solo);
      group.position.copy(spot);
      scene.add(group);

      const actor: Actor = {
        id: p.id,
        group,
        mixer,
        actions,
        current: "",
        after: null,
        scale: 1,
        idle: spot.clone(),
        target: spot.clone(),
      };
      actors.current.set(p.id, actor);
      play(actor, "Idle");
    });

    // rescale + re-place when the count changes
    const count = state.current.players.length;
    const scale = count === 1 ? 1 : count === 2 ? 0.92 : count <= 4 ? 0.84 : 0.74;
    state.current.players.forEach((p, i) => {
      const actor = actors.current.get(p.id);
      if (!actor) return;
      actor.scale = scale;
      actor.group.scale.setScalar(scale);
      actor.idle.copy(idleSpot(i, count, state.current.solo));
    });

    cameraFor(count);
  }

  useEffect(() => {
    syncActors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.length, solo]);

  /* ------------------------------------------------------------------ */

  const labels = useMemo(
    () =>
      players.map((p, i) => {
        const idx = results.findIndex((r) => r.id === p.id);
        const r = idx >= 0 ? results[idx] : null;
        const shown = phase === "results" && r !== null && idx < revealed;
        return { p, r: shown ? r : null, pending: phase === "results" && !shown };
      }),
    [players, results, revealed, phase]
  );

  return (
    <div ref={mount} className="absolute inset-0">
      {!ready && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-bg">
          <div className="flex flex-col items-center gap-3">
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-red transition-[width] duration-200"
                style={{ width: `${Math.max(6, loadPct * 100)}%` }}
              />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
              Loading stage {Math.round(loadPct * 100)}%
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0">
        {(phase === "demo" || phase === "countdown" || phase === "record") &&
          labels.map(({ p, r, pending }) => (
          <div
            key={p.id}
            ref={(el) => {
              if (el) labelRefs.current.set(p.id, el);
              else labelRefs.current.delete(p.id);
            }}
            className="absolute left-0 top-0 flex flex-col items-center gap-0.5 opacity-0 will-change-transform"
          >
            {r ? (
              <div
                className={`animate-pop rounded-lg px-2 py-0.5 text-[clamp(11px,1.7vh,18px)] font-black tabular-nums shadow-lg ${
                  r.total >= 90
                    ? "bg-gold text-black"
                    : r.total >= 70
                    ? "bg-red text-white"
                    : "bg-white/20 text-ink"
                }`}
              >
                {r.total}
              </div>
            ) : pending ? (
              <div className="rounded-lg bg-white/10 px-2 py-0.5 text-[10px] font-black text-white/40">
                ?
              </div>
            ) : null}
            <div
              className={`max-w-[140px] truncate rounded-full bg-black/80 px-2 py-0.5 text-[9px] font-bold ring-1 ${
                p.id === meId ? "ring-red/70 text-red" : "ring-white/10"
              }`}
            >
              {p.name}
              {p.id === meId ? " · you" : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function idleSpot(index: number, count: number, solo: boolean): THREE.Vector3 {
  if (count <= 1) return new THREE.Vector3(0.85, 0, 0.02);
  const maxX = Math.min(1.9, 0.55 + count * 0.18);
  const x = (index / (count - 1) - 0.5) * maxX * 2;
  const z = -0.2 - Math.abs(x) * 0.18;
  return new THREE.Vector3(x, 0, z);
}

function prepare(fbx: THREE.Object3D) {
  const palette: Record<string, number> = {
    Main: 0x7fb84a,
    Stripe: 0x3f6b2e,
    Eyes: 0xf2efe9,
    Nails: 0x1c1c1a,
    White: 0xe8e2d6,
  };

  fbx.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const built = mats.map((old: any) => {
      const key = Object.keys(palette).find((k) => old?.name?.includes(k));
      return new THREE.MeshStandardMaterial({
        color: key ? palette[key] : 0x7fb84a,
        roughness: old?.name?.includes("Eyes") ? 0.25 : 0.72,
        metalness: 0.04,
      });
    });
    m.material = Array.isArray(m.material) ? built : built[0];
  });

  let box = new THREE.Box3().setFromObject(fbx);
  let size = box.getSize(new THREE.Vector3());
  const scale = 2.05 / Math.max(size.y, 0.001);
  fbx.scale.setScalar(scale);
  fbx.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(fbx);
  fbx.position.y -= box.min.y;
  fbx.position.x -= (box.min.x + box.max.x) / 2;
  fbx.position.z -= (box.min.z + box.max.z) / 2;
}

function play(
  actor: Actor,
  name: string,
  once = false,
  clamp = false
): void {
  const key =
    actor.actions[name] !== undefined
      ? name
      : Object.keys(actor.actions).find((k) => k.endsWith(name));
  const next = key ? actor.actions[key] : undefined;
  if (!next || actor.current === key) return;
  const prev = actor.actions[actor.current];

  next.reset();
  next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  next.clampWhenFinished = clamp;
  next.enabled = true;
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(1);
  next.fadeIn(0.22);
  next.play();
  if (prev) prev.fadeOut(0.22);
  actor.current = key!;
}

function celebrate(actor: Actor, r: ResultView, winner = false) {
  if (winner) {
    play(actor, "Clapping");
    actor.after = null;
    return;
  }
  if (r.total < 25) {
    play(actor, "Death", true, true);
    actor.after = null;
    return;
  }
  if (r.total >= 85) {
    play(actor, "Jump", true, false);
    actor.after = "Clapping";
    setTimeout(() => {
      if (actor.after === "Clapping") play(actor, "Clapping");
      actor.after = null;
    }, 850);
    return;
  }
  play(actor, "Clapping");
  actor.after = null;
}


