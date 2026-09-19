"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SOLVED_CUBE, applyMoves, applyMove, type Move, type Sticker } from "./cube.ts";
import { drawCube, easeInOut } from "./cubeView.ts";
import { buildRingLayout, drawRings } from "./ringView.ts";

// A pre-solved Jev run on a fixed-size stage with a deterministic clock, so a video can be captured
// frame by frame (window.__render.seek(t)) with no waiting on Jev. Just the cube and the ring graph:
// it opens on the scrambled cube, plays Jev's solution, then spins.
// URL: /render?run=600&size=1800x1200 (add &capture=1 for frame capture).

type Run = { scramble: Move[]; steps: { moves: Move[] }[] };
type Seg = { move: Move; start: number; dur: number };

const T = { hold: 0.8, move: 0.12, moveGap: 0.012, stepGap: 0.06, spinDelay: 0.2, spin: 2.6, end: 0.8 };
const HOME = { yaw: -0.6, pitch: 0.5 };
const ring = buildRingLayout();
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Back-to-back turns of the same face play as one (D then D' cancel, D then D becomes D2). Jev's steps
// are unchanged; this only skips turns a person would never physically make.
const quarter = (m: Move) => (m.endsWith("2") ? 2 : m.endsWith("'") ? 3 : 1);
function mergeTurns(run: Run) {
  const out: { move: Move; endsStep: boolean }[] = [];
  for (const step of run.steps) {
    step.moves.forEach((move, k) => {
      const endsStep = k === step.moves.length - 1;
      const last = out.at(-1);
      if (last && last.move[0] === move[0]) {
        const turns = (quarter(last.move) + quarter(move)) % 4;
        out.pop();
        if (turns) out.push({ move: `${move[0]}${["", "", "2", "'"][turns]}` as Move, endsStep: endsStep || last.endsStep });
      } else out.push({ move, endsStep });
    });
  }
  return out;
}

function buildTimeline(run: Run) {
  const segs: Seg[] = [];
  let t = T.hold;
  for (const { move, endsStep } of mergeTurns(run)) {
    segs.push({ move, start: t, dur: T.move });
    t += T.move + T.moveGap + (endsStep ? T.stepGap : 0);
  }
  const spinStart = t + T.spinDelay;
  // cube state before each segment, for O(1) lookup at any time
  const states: Sticker[][] = [applyMoves(SOLVED_CUBE, run.scramble)];
  for (const seg of segs) states.push(applyMove(states.at(-1)!, seg.move));
  return { segs, states, spinStart, duration: spinStart + T.spin + T.end };
}

function readSize() {
  const [w, h] = (new URLSearchParams(window.location.search).get("size") ?? "1800x1200").split("x").map(Number);
  return w > 0 && h > 0 ? { w, h } : { w: 1800, h: 1200 };
}

export default function RenderView() {
  const [run, setRun] = useState<Run | null>(null);
  const [size, setSize] = useState({ w: 1800, h: 1200 });
  const [scale, setScale] = useState(1);
  const cubeRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLCanvasElement>(null);
  const timeline = useMemo(() => (run ? buildTimeline(run) : null), [run]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("run") ?? "600";
    const fit = () => {
      const next = readSize();
      setSize(next);
      setScale(Math.min(window.innerWidth / next.w, window.innerHeight / next.h));
    };
    fetch(`/runs/${id}.json`).then((r) => r.json()).then((data: Run) => { fit(); setRun(data); });
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const draw = useCallback((t: number) => {
    if (!timeline || !cubeRef.current || !ringRef.current) return;
    const { segs, states, spinStart } = timeline;
    // last segment that has started
    let lo = 0, hi = segs.length - 1, i = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].start <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    let stickers = states[0];
    let turn: { move: Move; t: number } | null = null;
    if (i >= 0) {
      const p = (t - segs[i].start) / segs[i].dur;
      if (p >= 1) stickers = states[i + 1];
      else { stickers = states[i]; turn = { move: segs[i].move, t: p }; }
    }
    const s = clamp01((t - spinStart) / T.spin);
    const view = { yaw: HOME.yaw + Math.PI * 2 * easeInOut(s), pitch: HOME.pitch + 0.14 * Math.sin(Math.PI * s) };
    const paint = (canvas: HTMLCanvasElement, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      fn(ctx, canvas.width / 2, canvas.height / 2);
    };
    paint(cubeRef.current, (ctx, w, h) => drawCube(ctx, w, h, stickers, view, turn, 1.18));
    paint(ringRef.current, (ctx, w, h) => drawRings(ctx, w, h, ring, stickers, turn, 0.86));
  }, [timeline]);

  // Live preview plays on the wall clock; ?capture=1 waits for seek() calls instead.
  useEffect(() => {
    if (!timeline) return;
    (window as unknown as { __render: unknown }).__render = { duration: timeline.duration, seek: draw };
    if (new URLSearchParams(window.location.search).has("capture")) { draw(0); return; }
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      draw(((now - began) / 1000) % (timeline.duration + 1));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timeline, draw, size]);

  const half = { width: size.w * 0.45, height: size.h };
  return (
    <div className="render-root">
      <div className="render-stage" style={{ width: size.w, height: size.h, marginLeft: -size.w / 2, marginTop: -size.h / 2, transform: `scale(${scale})` }}>
        <canvas ref={cubeRef} className="render-cube" style={{ left: size.w * 0.05, ...half }} width={half.width * 2} height={half.height * 2} />
        <canvas ref={ringRef} className="render-ring" style={{ left: size.w * 0.5, ...half }} width={half.width * 2} height={half.height * 2} />
      </div>
    </div>
  );
}
