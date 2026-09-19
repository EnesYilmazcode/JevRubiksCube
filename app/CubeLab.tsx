"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COLOR_HEX, FACES, MOVES, SOLVED_CUBE, applyMove, applyMoves,
  faceGrid, isSolved, makeScramble, solvedStickerCount,
  type Face, type Move, type Sticker,
} from "./cube";

type Decision = {
  move: Move;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  inputTokens: number;
  latencyMs: number;
};

const FACE_TRANSFORMS: Record<Face, string> = {
  F: "translateZ(96px)", B: "rotateY(180deg) translateZ(96px)",
  R: "rotateY(90deg) translateZ(96px)", L: "rotateY(-90deg) translateZ(96px)",
  U: "rotateX(90deg) translateZ(96px)", D: "rotateX(-90deg) translateZ(96px)",
};
const MOVE_NAME = Object.fromEntries(MOVES.map((move) => [
  move,
  move.endsWith("'") ? `${move[0]} counterclockwise` : move.endsWith("2") ? `${move[0]} 180 degrees` : `${move} clockwise`,
])) as Record<Move, string>;

function Cube3D({ stickers, moving }: { stickers: Sticker[]; moving: boolean }) {
  const [rotation, setRotation] = useState({ x: -24, y: 34 });
  const drag = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null);
  return (
    <div
      className="cube-stage"
      aria-label="Interactive three-dimensional Rubik's Cube"
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY, rx: rotation.x, ry: rotation.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        setRotation({
          x: drag.current.rx - (event.clientY - drag.current.y) * 0.35,
          y: drag.current.ry + (event.clientX - drag.current.x) * 0.35,
        });
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <div className="cube-shadow" />
      <div className={`cube ${moving ? "cube-moving" : ""}`} style={{ transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)` }}>
        {FACES.map((face) => (
          <div className="cube-face" key={face} style={{ transform: FACE_TRANSFORMS[face] }}>
            {faceGrid(stickers, face).map((sticker) => (
              <div className="cube-sticker" key={sticker.id} style={{ background: COLOR_HEX[sticker.color] }} />
            ))}
          </div>
        ))}
      </div>
      <span className="stage-hint">drag to orbit</span>
    </div>
  );
}

type GraphNode = { sticker: Sticker; face: Face; row: number; col: number; x: number; y: number };

function CubeGraph({ stickers }: { stickers: Sticker[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const draw = () => {
      const size = Math.max(300, Math.min(parent.getBoundingClientRect().width, 560));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, size, size);
      const center = size / 2;
      const orbit = size * 0.31;
      const cluster = size * 0.055;
      const nodes: GraphNode[] = [];
      const byFaceCell = new Map<string, GraphNode>();

      FACES.forEach((face, faceIndex) => {
        const angle = -Math.PI / 2 + faceIndex * Math.PI * 2 / FACES.length;
        const cx = center + Math.cos(angle) * orbit;
        const cy = center + Math.sin(angle) * orbit;
        const cos = Math.cos(angle + Math.PI / 2);
        const sin = Math.sin(angle + Math.PI / 2);
        faceGrid(stickers, face).forEach((sticker, index) => {
          const row = Math.floor(index / 3);
          const col = index % 3;
          const lx = (col - 1) * cluster;
          const ly = (row - 1) * cluster;
          const node = { sticker, face, row, col, x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
          nodes.push(node);
          byFaceCell.set(`${face}:${row}:${col}`, node);
        });
      });

      ctx.strokeStyle = "rgba(145,154,173,.18)";
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 4; ring += 1) {
        ctx.beginPath();
        ctx.arc(center, center, size * (0.085 + ring * 0.073), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(171,181,204,.28)";
      for (const node of nodes) {
        for (const [dr, dc] of [[1, 0], [0, 1]]) {
          const neighbor = byFaceCell.get(`${node.face}:${node.row + dr}:${node.col + dc}`);
          if (!neighbor) continue;
          ctx.beginPath(); ctx.moveTo(node.x, node.y); ctx.lineTo(neighbor.x, neighbor.y); ctx.stroke();
        }
      }
      const cubies = new Map<string, GraphNode[]>();
      for (const node of nodes) {
        const key = node.sticker.pos.join(",");
        cubies.set(key, [...(cubies.get(key) || []), node]);
      }
      ctx.strokeStyle = "rgba(209,217,235,.2)";
      for (const group of cubies.values()) {
        for (let index = 1; index < group.length; index += 1) {
          const start = group[0];
          const end = group[index];
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.quadraticCurveTo(center + (start.x + end.x - center * 2) * .2, center + (start.y + end.y - center * 2) * .2, end.x, end.y);
          ctx.stroke();
        }
      }
      for (const node of nodes) {
        const radius = node.row === 1 && node.col === 1 ? size * .016 : size * .012;
        ctx.beginPath(); ctx.arc(node.x, node.y, radius + 2, 0, Math.PI * 2); ctx.fillStyle = "rgba(7,9,13,.94)"; ctx.fill();
        ctx.beginPath(); ctx.arc(node.x, node.y, radius, 0, Math.PI * 2); ctx.fillStyle = COLOR_HEX[node.sticker.color]; ctx.fill();
      }
      ctx.font = `500 ${Math.max(11, size * .027)}px ui-monospace, monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(232,236,246,.72)";
      FACES.forEach((face, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / FACES.length;
        ctx.fillText(face, center + Math.cos(angle) * size * .43, center + Math.sin(angle) * size * .43);
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [stickers]);
  return (
    <div className="graph-stage">
      <canvas ref={canvasRef} role="img" aria-label="All 54 cube stickers grouped by face, with graph edges joining adjacent stickers and stickers on the same cubie" />
      <span className="stage-hint">54 sticker nodes · shared-cubie edges</span>
    </div>
  );
}

export default function CubeLab() {
  const [stickers, setStickers] = useState<Sticker[]>(SOLVED_CUBE);
  const [history, setHistory] = useState<Move[]>([]);
  const [scramble, setScramble] = useState<Move[]>([]);
  const [scrambleLength, setScrambleLength] = useState(7);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [status, setStatus] = useState("Ready for a scramble");
  const [moving, setMoving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const stateRef = useRef(stickers);
  const historyRef = useRef(history);
  useEffect(() => { stateRef.current = stickers; }, [stickers]);
  useEffect(() => { historyRef.current = history; }, [history]);
  const score = solvedStickerCount(stickers);
  const solved = isSolved(stickers);

  const moveCube = useCallback((move: Move, source = "Manual move") => {
    setMoving(true);
    setStickers((current) => applyMove(current, move));
    setHistory((current) => [...current, move]);
    setStatus(`${source}: ${MOVE_NAME[move]}`);
    window.setTimeout(() => setMoving(false), 280);
  }, []);

  const reset = useCallback(() => {
    setStickers(SOLVED_CUBE); setHistory([]); setScramble([]); setDecision(null);
    setTotalTokens(0); setAutoRunning(false); setStatus("Solved state restored");
  }, []);
  const scrambleCube = useCallback(() => {
    const moves = makeScramble(scrambleLength);
    setStickers(applyMoves(SOLVED_CUBE, moves)); setHistory([]); setScramble(moves);
    setDecision(null); setTotalTokens(0); setStatus(`${scrambleLength}-move scramble loaded`);
  }, [scrambleLength]);

  const askJev = useCallback(async (): Promise<boolean> => {
    if (asking || isSolved(stateRef.current)) return false;
    setAsking(true); setStatus("Jev is comparing 18 legal rotations…");
    const started = performance.now();
    try {
      const response = await fetch("/api/jev", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ stickers: stateRef.current, history: historyRef.current.slice(-8) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Jev request failed");
      const next: Decision = { ...body, latencyMs: Math.round(performance.now() - started) };
      setDecision(next); setTotalTokens((value) => value + next.inputTokens); moveCube(next.move, "Jev chose");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Jev request failed");
      return false;
    } finally { setAsking(false); }
  }, [asking, moveCube]);

  useEffect(() => {
    if (!autoRunning || asking) return;
    if (solved) { setAutoRunning(false); setStatus(`Solved by Jev in ${history.length} moves`); return; }
    if (history.length >= 40) { setAutoRunning(false); setStatus("Stopped at the 40-decision safety limit"); return; }
    const timer = window.setTimeout(async () => { if (!(await askJev())) setAutoRunning(false); }, 420);
    return () => window.clearTimeout(timer);
  }, [askJev, asking, autoRunning, history.length, solved]);

  const topProbabilities = useMemo(() => decision ? Object.entries(decision.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3) : [], [decision]);

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">J</span><div><p className="eyebrow">Jev decision experiment</p><h1>Can a model that only chooses solve a cube?</h1></div></div>
        <div className={`connection-pill ${decision ? "connected" : ""}`}><span className="connection-dot" />{decision ? decision.model : "waiting for first Jev call"}</div>
      </header>

      <section className="experiment-bar" aria-label="Experiment controls">
        <div className="scramble-control">
          <label htmlFor="scramble-length">Scramble</label>
          <select id="scramble-length" value={scrambleLength} onChange={(event) => setScrambleLength(Number(event.target.value))}>
            {[3, 5, 7, 10, 15, 20].map((length) => <option key={length} value={length}>{length} moves</option>)}
          </select>
          <button className="button secondary" onClick={scrambleCube}>New scramble</button>
        </div>
        <div className="primary-actions">
          <button className="button secondary" onClick={reset}>Reset</button>
          <button className="button primary" onClick={() => void askJev()} disabled={asking || solved}>{asking ? "Choosing…" : "Ask Jev once"}</button>
          <button className={`button ${autoRunning ? "danger" : "primary"}`} onClick={() => { setAutoRunning((value) => !value); setStatus(autoRunning ? "Auto-run stopped" : "Auto-run started · maximum 40 decisions"); }} disabled={solved}>{autoRunning ? "Stop" : "Run Jev"}</button>
        </div>
      </section>

      <section className="visual-grid">
        <article className="visual-panel"><div className="panel-heading"><div><span>01</span><h2>Physical state</h2></div><small>interactive 3D</small></div><Cube3D stickers={stickers} moving={moving} /></article>
        <article className="visual-panel"><div className="panel-heading"><div><span>02</span><h2>Sticker graph</h2></div><small>all sides at once</small></div><CubeGraph stickers={stickers} /></article>
      </section>

      <section className="decision-strip" aria-live="polite">
        <div className="decision-state"><i className={`state-light ${solved ? "solved" : asking ? "thinking" : ""}`} /><div><span>Current state</span><strong>{status}</strong></div></div>
        <div className="metric"><span>Face-correct</span><strong>{score}<small>/54</small></strong></div>
        <div className="metric"><span>Decisions</span><strong>{history.length}</strong></div>
        <div className="metric"><span>Confidence</span><strong>{decision ? `${Math.round(decision.confidence * 100)}%` : "—"}</strong></div>
        <div className="metric"><span>Input tokens</span><strong>{totalTokens.toLocaleString()}</strong></div>
      </section>

      <section className="move-console">
        <div className="move-heading"><div><p className="eyebrow">Bounded action space</p><h2>18 legal rotations</h2></div><p>{scramble.length ? `Scramble: ${scramble.join(" ")}` : "Load a scramble, then let Jev choose one move at a time."}</p></div>
        <div className="move-buttons">{MOVES.map((move) => <button key={move} className={decision?.move === move ? "selected" : ""} onClick={() => moveCube(move)} aria-label={MOVE_NAME[move]}>{move}</button>)}</div>
        <div className="decision-detail">
          <div className="last-choice"><span>Last Jev choice</span><strong>{decision?.move ?? "—"}</strong><small>{decision ? `${decision.latencyMs} ms round trip` : "No model decision yet"}</small></div>
          <div className="probability-bars">{topProbabilities.length ? topProbabilities.map(([move, probability]) => <div className="probability" key={move}><span>{move.replace("_prime", "'")}</span><div><i style={{ width: `${Math.max(2, probability * 100)}%` }} /></div><b>{Math.round(probability * 100)}%</b></div>) : <p>Jev’s top three move probabilities will appear here.</p>}</div>
          <div className="history"><span>Move history</span><p>{history.length ? history.join(" ") : "—"}</p></div>
        </div>
      </section>
      <footer><p>Jev sees serialized facelets and 18 candidate next states. It never sees the rendered cube.</p><p>No solver path or distance heuristic is supplied.</p></footer>
    </main>
  );
}
