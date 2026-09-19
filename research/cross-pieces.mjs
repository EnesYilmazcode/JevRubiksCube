// Cross diagnostic with a piece summary: where each white edge sits, next to the full faces.
import { experimental_evaluate as evaluate } from "ai";
import { SOLVED_CUBE, applyMoves, serializeCube, faceForNormal } from "../app/cube.ts";
import { STAGES } from "../app/method.ts";
import { demoScramble } from "../app/solver.ts";

const mode = process.argv[2] ?? "pieces", N = Number(process.argv[3] ?? 8);
const stage = STAGES.find((s) => s.id === "cross");
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }
const COLOR = { green: "green", red: "red", blue: "blue", orange: "orange" };
const slotName = (pos) => pos.map((v, i) => (v === 0 ? "" : ["R", "U", "F"][i] === undefined ? "" : v > 0 ? "RUF"[i] : "LDB"[i])).join("");
function whiteEdges(s) {
  const out = [];
  for (const w of s.filter((x) => x.color === "white" && x.pos.filter((v) => v === 0).length === 1)) {
    const other = s.find((x) => x.pos.join() === w.pos.join() && x !== w);
    out.push(`white-${other.color} edge at ${slotName(w.pos)}, white facing ${faceForNormal(w.normal)}`);
  }
  return out.sort().join("; ");
}
const target = whiteEdges(SOLVED_CUBE);
const key = (s) => Object.values(serializeCube(s)).join("");
function bfs(start, check, maxDepth = 3) {
  if (check(start)) return start; let f = [start]; const seen = new Set([key(start)]);
  for (let d = 1; d <= maxDepth; d++) { const n = []; for (const s of f) for (const m of stage.macros) { const c = applyMoves(s, m.moves); const k = key(c); if (seen.has(k)) continue; seen.add(k); if (check(c)) return c; n.push(c); } f = n; }
  return null;
}
const ranks = [];
for (let i = 0; i < N; i++) {
  let s = applyMoves(SOLVED_CUBE, demoScramble(20, rng(900 + i)));
  for (let k = 0; k < 4; k++) {
    const check = stage.checks[k];
    if (check(s)) continue;
    const opts = stage.macros.map((m) => ({ m, r: applyMoves(s, m.moves) })).sort(() => Math.random() - 0.5);
    const good = new Set(opts.filter((o) => check(o.r)).map((o) => o.m.id));
    if (good.size) {
      const criteria = Object.fromEntries(opts.map((o) => [o.m.id, mode === "pieces"
        ? `${o.m.label} -> white edges: ${whiteEdges(o.r)}. Faces: ${JSON.stringify(serializeCube(o.r))}`
        : `${o.m.label} -> white edges: ${whiteEdges(o.r)}`]));
      const state = { puzzle: "3x3 Rubik's Cube", stage: "White cross", goal: stage.goal, current_white_edges: whiteEdges(s), target_white_edges: target, current_faces: serializeCube(s),
        notation: "Slots are named by the faces they touch: U white side, D yellow side, F front, B back, R right, L left." };
      let probs;
      for (let a = 0; a < 5 && !probs; a++) { try { probs = (await evaluate({ model: "typesafe-ai/jev", state, questions: { step: { type: "choice", instructions: "Choose the step after which more white edges match their target slot and facing than now, without moving white edges that already match.", criteria } } })).answers.step.probabilities; } catch (e) { probs = e?.data?.step?.probabilities; if (!probs) await new Promise((r) => setTimeout(r, 800)); } }
      const order = Object.entries(probs).sort((a, b) => b[1] - a[1]).map(([id]) => id);
      ranks.push(order.findIndex((id) => good.has(id)) + 1);
    }
    s = bfs(s, check) ?? s;
  }
}
console.log(mode, "ranks", ranks.join(","), `top1 ${ranks.filter((r) => r === 1).length}/${ranks.length} top3 ${ranks.filter((r) => r <= 3).length}/${ranks.length}`);
console.log("target:", target);
