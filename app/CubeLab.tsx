"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SOLVED_CUBE, applyMove, type Move, type Sticker } from "./cube.ts";
import { drawCube, easeInOut, type CubeTurn, type CubeView } from "./cubeView.ts";
import { STAGES } from "./method.ts";
import { buildRingLayout, drawRings } from "./ringView.ts";
import { demoScramble, solveWithJev, solveWithMethod, type AskJev, type AskStep } from "./solver.ts";

type Source = "scramble" | "jev" | "manual";
type TapeItem = { move: Move; source: Source; probability?: number };
type StepView = { stage: number; label: string; probability: number; from: number; to: number };
type Phase = "ready" | "scrambling" | "scrambled" | "thinking" | "solving" | "solved" | "failed" | "error";
type Queued = { move: Move; duration: number; gap: number; index: number };
type Stats = { calls: number; tokens: number; ms: number; moves: number; steps: number };
type Run = { scramble: Move[]; solution: TapeItem[]; steps: StepView[]; stats: Stats };

const HOME_VIEW: CubeView = { yaw: -0.6, pitch: 0.5 };
const SCRAMBLE_MS = 220;
const FAST_SCRAMBLE_MS = 100;
const SOLVE_MS = 400;
const SOLVE_GAP_MS = 130;
const METHOD_MS = 140;
const METHOD_GAP_MS = 15;
const STEP_GAP_MS = 170;
const SPIN_MS = 4600;
const BEAM_WIDTH = 4;
const MAX_DEPTH = 8;
const PRICE_PER_TOKEN = 0.042e-6;
/** Scrambles this long or longer are solved with Jev running the beginner's method. */
const METHOD_MIN = 6;
const DEPTHS = [2, 3, 4, 20];
const STAGE_SHORT = ["Cross", "Corners", "Middle", "Yellow cross", "Yellow edges", "Place corners", "Twist corners"];

const ring = buildRingLayout();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sizeCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

// The route retries Jev's 503 bursts itself; the client only retries a few times more, briefly.
async function postJev(body: unknown) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch("/api/jev", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Jev request failed");
      return data;
    } catch (error) {
      if (attempt >= 4) throw error;
      await sleep(400 + attempt * 600);
    }
  }
}

export default function CubeLab() {
  const cubeRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef({
    stickers: SOLVED_CUBE as Sticker[],
    queue: [] as Queued[],
    current: null as (Queued & { start: number }) | null,
    pauseUntil: 0,
    view: { ...HOME_VIEW },
    spinStart: -1,
    dirty: true,
    waiters: [] as (() => void)[],
  });
  const [phase, setPhase] = useState<Phase>("ready");
  const [depth, setDepth] = useState(20);
  const [tape, setTapeState] = useState<TapeItem[]>([]);
  const tapeRef = useRef<TapeItem[]>([]);
  const setTape = useCallback((next: TapeItem[]) => { tapeRef.current = next; setTapeState(next); }, []);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [active, setActive] = useState(-1);
  const [animating, setAnimating] = useState(false);
  const [calls, setCalls] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [message, setMessage] = useState("");
  const [chrome, setChrome] = useState(true);
  const lastRun = useRef<Run | null>(null);
  const [canReplay, setCanReplay] = useState(false);
  const methodMode = tape.filter((item) => item.source !== "jev").length >= METHOD_MIN || (tape.length === 0 && depth >= METHOD_MIN);
  const busy = phase === "scrambling" || phase === "thinking" || phase === "solving";
  // ?speed=0.25 slows every animation for recording or inspection
  const speed = useRef(1);
  useEffect(() => {
    const value = Number(new URLSearchParams(window.location.search).get("speed"));
    if (value > 0) speed.current = value;
  }, []);

  // One animation loop drives both canvases.
  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(() => { engine.current.dirty = true; });
    if (cubeRef.current) observer.observe(cubeRef.current);
    if (ringRef.current) observer.observe(ringRef.current);
    const tick = (now: number) => {
      const e = engine.current;
      if (!e.current && e.queue.length && now >= e.pauseUntil) {
        e.current = { ...e.queue.shift()!, start: now };
        setActive(e.current.index);
        setAnimating(true);
      }
      let turn: CubeTurn = null;
      if (e.current) {
        const t = (now - e.current.start) / e.current.duration;
        if (t >= 1) {
          e.stickers = applyMove(e.stickers, e.current.move);
          e.pauseUntil = now + e.current.gap;
          e.current = null;
          if (!e.queue.length) {
            setAnimating(false);
            e.waiters.splice(0).forEach((resolve) => resolve());
          }
        } else {
          turn = { move: e.current.move, t };
        }
        e.dirty = true;
      }
      const view = { ...e.view };
      if (e.spinStart >= 0) {
        const s = (now - e.spinStart) / (SPIN_MS / speed.current);
        if (s >= 1) e.spinStart = -1;
        else { view.yaw += Math.PI * 2 * easeInOut(s); view.pitch += 0.14 * Math.sin(Math.PI * s); }
        e.dirty = true;
      }
      if (e.dirty && cubeRef.current && ringRef.current) {
        const c = sizeCanvas(cubeRef.current);
        drawCube(c.ctx, c.width, c.height, e.stickers, view, turn);
        const r = sizeCanvas(ringRef.current);
        drawRings(r.ctx, r.width, r.height, ring, e.stickers, turn);
        e.dirty = false;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  const play = useCallback((items: Queued[]) => new Promise<void>((resolve) => {
    const e = engine.current;
    if (!items.length && !e.queue.length && !e.current) { resolve(); return; }
    e.queue.push(...items.map((item) => ({ ...item, duration: item.duration / speed.current, gap: item.gap / speed.current })));
    e.waiters.push(resolve);
  }), []);

  const resetCube = useCallback(() => {
    const e = engine.current;
    e.queue = []; e.current = null; e.stickers = SOLVED_CUBE; e.spinStart = -1; e.dirty = true;
    e.waiters.splice(0).forEach((resolve) => resolve());
    setTape([]); setSteps([]); setActive(-1); setAnimating(false); setStats(null); setCalls(0); setMessage(""); setPhase("ready");
  }, [setTape]);

  const playScramble = useCallback(async (moves: Move[]) => {
    setTape(moves.map((move) => ({ move, source: "scramble" })));
    setPhase("scrambling");
    const ms = moves.length >= METHOD_MIN ? FAST_SCRAMBLE_MS : SCRAMBLE_MS;
    await play(moves.map((move, index) => ({ move, duration: ms, gap: 40, index })));
    setPhase("scrambled");
  }, [play, setTape]);

  const scramble = useCallback(async (length = depth) => {
    resetCube();
    lastRun.current = null; setCanReplay(false);
    await playScramble(demoScramble(length));
  }, [depth, playScramble, resetCube]);

  const finish = useCallback((run: Run) => {
    lastRun.current = run; setCanReplay(true);
    setPhase("solved");
    engine.current.spinStart = performance.now();
  }, []);

  // Short scrambles: Jev ranks single turns inside a small beam search, then the found line plays.
  const solveShort = useCallback(async (start: Sticker[], began: number) => {
    const ask: AskJev = async (stickers, moves) => {
      const body = await postJev({ stickers, moves });
      return { probabilities: body.probabilities, tokens: body.inputTokens ?? 0 };
    };
    setPhase("thinking");
    const result = await solveWithJev(start, ask, { width: BEAM_WIDTH, maxDepth: MAX_DEPTH, onProgress: (p) => setCalls(p.calls) });
    const moves = result.path?.length ?? 0;
    const runStats = { calls: result.calls, tokens: result.tokens, ms: performance.now() - began, moves, steps: moves };
    setStats(runStats);
    if (!result.path) { setPhase("failed"); return; }
    const base = tapeRef.current.length;
    const solution = result.path.map((step) => ({ move: step.move, source: "jev" as const, probability: step.probability }));
    const scrambleMoves = tapeRef.current.map((item) => item.move);
    setTape([...tapeRef.current, ...solution]);
    setPhase("solving");
    await sleep(350);
    await play(result.path.map((step, i) => ({ move: step.move, duration: SOLVE_MS, gap: SOLVE_GAP_MS, index: base + i })));
    finish({ scramble: scrambleMoves, solution, steps: [], stats: runStats });
  }, [finish, play, setTape]);

  // Full scrambles: Jev picks every step of the beginner's method; each step plays as soon as it is chosen.
  const solveMethod = useCallback(async (start: Sticker[], began: number) => {
    const scrambleMoves = tapeRef.current.map((item) => item.move);
    const views: StepView[] = [];
    setSteps([]);
    setPhase("solving");
    const ask: AskStep = async (stickers, stage, macros, check) => {
      const body = await postJev({ stickers, stage: stage.id, steps: macros.map((m) => m.id), check });
      return { probabilities: body.probabilities, tokens: body.inputTokens ?? 0 };
    };
    const result = await solveWithMethod(start, ask, {
      onProgress: (p) => setCalls(p.calls),
      onSteps: (found) => {
        for (const step of found) {
          const from = tapeRef.current.length;
          const moves = step.macro.moves;
          setTape([...tapeRef.current, ...moves.map((move) => ({ move, source: "jev" as const, probability: step.probability }))]);
          views.push({ stage: STAGES.indexOf(step.stage), label: step.macro.label, probability: step.probability, from, to: from + moves.length });
          void play(moves.map((move, i) => ({ move, duration: METHOD_MS, gap: i === moves.length - 1 ? STEP_GAP_MS : METHOD_GAP_MS, index: from + i })));
        }
        setSteps([...views]);
      },
    });
    await play([]);
    const solution = tapeRef.current.slice(scrambleMoves.length);
    const runStats = { calls: result.calls, tokens: result.tokens, ms: performance.now() - began, moves: solution.length, steps: views.length };
    setStats(runStats);
    if (!result.solved) { setMessage(STAGES.find((s) => s.id === result.failedStage)?.title ?? ""); setPhase("failed"); return; }
    finish({ scramble: scrambleMoves, solution, steps: views, stats: runStats });
  }, [finish, play, setTape]);

  const solve = useCallback(async () => {
    setCalls(0); setStats(null); setMessage(""); setSteps([]);
    setPhase("thinking");
    await play([]); // let any manual turn finish first
    const start = engine.current.stickers;
    const began = performance.now();
    const scrambled = tapeRef.current.filter((item) => item.source !== "jev").length;
    try {
      if (scrambled >= METHOD_MIN) await solveMethod(start, began);
      else await solveShort(start, began);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Jev request failed");
      setPhase("error");
    }
  }, [play, solveMethod, solveShort]);

  // Replays the last solve with no Jev calls: same scramble, same moves, smooth pacing for recording.
  const replay = useCallback(async () => {
    const run = lastRun.current;
    if (!run) return;
    resetCube();
    await playScramble(run.scramble);
    await sleep(600);
    const base = run.scramble.length;
    setTape([...tapeRef.current, ...run.solution]);
    setSteps(run.steps);
    setStats(run.stats);
    setPhase("solving");
    const stepEnds = new Set(run.steps.map((s) => s.to - 1));
    const method = run.steps.length > 0;
    await play(run.solution.map((item, i) => ({
      move: item.move, index: base + i,
      duration: method ? METHOD_MS : SOLVE_MS,
      gap: method ? (stepEnds.has(base + i) ? STEP_GAP_MS : METHOD_GAP_MS) : SOLVE_GAP_MS,
    })));
    finish(run);
  }, [finish, play, playScramble, resetCube, setTape]);

  const manualMove = useCallback((move: Move) => {
    if (busy) return;
    const index = tapeRef.current.length;
    setTape([...tapeRef.current, { move, source: "manual" }]);
    void play([{ move, duration: SCRAMBLE_MS, gap: 0, index }]);
    setPhase("scrambled");
  }, [busy, play, setTape]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === "h") { setChrome((value) => !value); return; }
      if (key === " " || key === "enter") {
        event.preventDefault();
        if (busy) return;
        if (phase === "scrambled" || phase === "failed" || phase === "error") void solve();
        else void scramble();
        return;
      }
      if (key === "p" && !busy && lastRun.current) { void replay(); return; }
      if (/^[1-4]$/.test(key) && !busy) { setDepth(DEPTHS[Number(key) - 1]); return; }
      const face = event.key.toUpperCase();
      if ("UDRLFB".includes(face) && face.length === 1 && !event.metaKey && !event.ctrlKey) {
        manualMove(`${face}${event.shiftKey ? "'" : ""}` as Move);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, manualMove, phase, replay, scramble, solve]);

  // Drag the cube to orbit it.
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    const view = engine.current.view;
    drag.current = { x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const e = engine.current;
    e.view.yaw = drag.current.yaw + (event.clientX - drag.current.x) * 0.008;
    e.view.pitch = Math.max(-1.2, Math.min(1.2, drag.current.pitch + (event.clientY - drag.current.y) * 0.008));
    e.dirty = true;
  };
  const endDrag = () => { drag.current = null; };
  const recenter = () => { engine.current.view = { ...HOME_VIEW }; engine.current.dirty = true; };

  const scrambleCount = tape.filter((item) => item.source !== "jev").length;
  const cost = stats ? stats.tokens * PRICE_PER_TOKEN : 0;
  const playing = phase === "scrambling" || phase === "solving";
  const currentStep = steps.find((s) => active >= s.from && active < s.to) ?? steps.at(-1);
  const currentStage = phase === "solved" ? STAGES.length : currentStep?.stage ?? (phase === "solving" ? 0 : -1);
  const waitingOnJev = phase === "solving" && methodMode && !animating;

  const caption = {
    ready: methodMode
      ? "A real 20-move scramble. Jev solves it with the beginner's method, picking every step."
      : "A short scramble. Jev ranks single turns until the cube is solved.",
    scrambling: "Scrambling",
    scrambled: `Scrambled ${scrambleCount} ${scrambleCount === 1 ? "move" : "moves"}. Jev's turn.`,
    thinking: `Jev is ranking moves${calls ? ` · ${calls} ${calls === 1 ? "call" : "calls"}` : ""}`,
    solving: methodMode
      ? (waitingOnJev ? `Jev is choosing the next step · ${calls} calls` : `${currentStage + 1}. ${STAGES[Math.min(STAGES.length - 1, Math.max(0, currentStage))].title}`)
      : "Jev's solution",
    solved: `Solved in ${stats?.moves ?? 0} ${stats?.moves === 1 ? "move" : "moves"}`,
    failed: methodMode ? `Jev got stuck at: ${message || "a stage"}` : `No solution within ${MAX_DEPTH} moves`,
    error: message || "Jev request failed",
  }[phase];

  const statsLine = stats && (steps.length
    ? `${stats.moves} moves · ${stats.steps} steps picked by Jev · ${stats.calls} calls · ${(stats.ms / 1000).toFixed(0)} s · $${cost.toFixed(4)}`
    : `${stats.calls} Jev ${stats.calls === 1 ? "call" : "calls"} · ${(stats.ms / 1000).toFixed(1)} s · $${cost < 0.001 ? cost.toFixed(5) : cost.toFixed(4)}`);

  return (
    <main className={`stage ${chrome ? "" : "clean"}`}>
      <header className="masthead">
        <div>
          <h1>Jev vs. the Cube</h1>
          <p>{methodMode ? "Jev picks every step of the beginner's method. No solver in the loop." : "Jev ranks every legal turn. No solver, no distance hints."}</p>
        </div>
        <span className="model-tag"><i />typesafe-ai/jev</span>
      </header>

      <section className="scene">
        <div className="pane" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={recenter}>
          <canvas ref={cubeRef} className="cube-canvas" aria-label="Rubik's Cube" />
        </div>
        <div className="pane">
          <canvas ref={ringRef} className="ring-canvas" aria-label="All 54 stickers placed on the circles their layers turn along" />
        </div>
      </section>

      <section className="readout" aria-live="polite">
        <p className={`caption phase-${phase}`}>
          {(phase === "thinking" || phase === "scrambling" || waitingOnJev) && <span className="pulse" />}
          {caption}
        </p>

        {methodMode && (phase === "solving" || phase === "solved" || phase === "failed") ? (
          <>
            <ol className="stages">
              {STAGE_SHORT.map((name, i) => (
                <li key={name} className={i < currentStage ? "done" : i === currentStage ? "now" : ""}>{name}</li>
              ))}
            </ol>
            <div className="step">
              {currentStep && phase !== "solved" ? (
                <>
                  <span className="step-label">{currentStep.label}</span>
                  <ol className="tape small">
                    {tape.slice(currentStep.from, currentStep.to).map((item, i) => {
                      const index = currentStep.from + i;
                      const state = index === active && playing ? "active" : index < active ? "done" : "";
                      return <li key={index} className={`chip jev ${state}`}><b>{item.move}</b></li>;
                    })}
                  </ol>
                  <span className="step-prob">Jev {Math.round(currentStep.probability * 100)}%</span>
                </>
              ) : phase === "solved" ? <span className="step-label">{steps.length} steps, every one chosen by Jev</span> : null}
            </div>
          </>
        ) : methodMode && phase === "scrambling" ? (
          <p className="scramble-line">{tape.map((item) => item.move).join(" ")}</p>
        ) : (
          <ol className="tape">
            {tape.flatMap((item, index) => {
              const state = index === active && playing ? "active" : index < active || (index === active && !playing) ? "done" : "";
              const chip = (
                <li key={index} className={`chip ${item.source} ${state}`}>
                  <b>{item.move}</b>
                  {item.probability !== undefined && <small>{Math.round(item.probability * 100)}%</small>}
                </li>
              );
              const firstJev = item.source === "jev" && index > 0 && tape[index - 1].source !== "jev";
              return firstJev ? [<li key={`divider-${index}`} className="divider" aria-hidden />, chip] : [chip];
            })}
          </ol>
        )}
        <p className="stats">{statsLine}</p>
      </section>

      <nav className="controls" aria-label="Experiment controls">
        <div className="depth" role="group" aria-label="Scramble length">
          <span>Scramble</span>
          {DEPTHS.map((value) => (
            <button key={value} className={value === depth ? "on" : ""} onClick={() => setDepth(value)} disabled={busy}>{value}</button>
          ))}
        </div>
        <button className="btn" onClick={() => void scramble()} disabled={busy}>Scramble</button>
        <button className="btn primary" onClick={() => void solve()} disabled={busy || phase === "ready" || phase === "solved"}>Solve with Jev</button>
        <button className="btn ghost" onClick={() => void replay()} disabled={busy || !canReplay}>Replay</button>
        <button className="btn ghost" onClick={resetCube} disabled={busy} aria-label="Reset to solved">Reset</button>
      </nav>
      <p className="hint">Space: scramble / solve · P: replay last solve · 1-4: length · U D R L F B turn (Shift = prime) · H hides controls · drag to orbit</p>
    </main>
  );
}
