// For each method stage: at real sub-goal states (reached by exhaustive search from 20-move scrambles),
// where does Jev rank the menu options that complete the sub-goal in one step?
import { experimental_evaluate as evaluate } from "ai";
import { SOLVED_CUBE, applyMoves, serializeCube } from "../app/cube.ts";
import { STAGES } from "../app/method.ts";
import { stepRequest } from "../app/prompts.ts";
import { demoScramble } from "../app/solver.ts";

const only = process.argv[2];
const N = Number(process.argv[3] ?? 6);
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }
const key = (s) => Object.values(serializeCube(s)).join("");
function bfs(start, stage, check, maxDepth = 3) {
  if (check(start)) return start;
  let frontier = [start]; const seen = new Set([key(start)]);
  for (let d = 1; d <= maxDepth; d++) {
    const next = [];
    for (const s of frontier) for (const m of stage.macros) { const c = applyMoves(s, m.moves); const k = key(c); if (seen.has(k)) continue; seen.add(k); if (check(c)) return c; next.push(c); }
    frontier = next;
  }
  return null;
}
const results = {};
const jobs = [];
for (let i = 0; i < N; i++) {
  let s = applyMoves(SOLVED_CUBE, demoScramble(20, rng(900 + i)));
  for (const stage of STAGES) for (let k = 0; k < stage.checks.length; k++) {
    const check = stage.checks[k];
    if (!check(s)) {
      const opts = stage.macros.map((m) => ({ m, r: applyMoves(s, m.moves) }));
      const good = new Set(opts.filter((o) => check(o.r)).map((o) => o.m.id));
      if (good.size && (!only || only === stage.id)) jobs.push({ stage, k, s, good, n: opts.length });
      s = bfs(s, stage, check) ?? s;
    }
  }
}
let next = 0;
await Promise.all([0, 1, 2].map(async () => {
  while (next < jobs.length) {
    const j = jobs[next++];
    const req = stepRequest(j.s, j.stage, j.stage.macros);
    let probs;
    for (let a = 0; a < 4 && !probs; a++) {
      try { probs = (await evaluate({ model: "typesafe-ai/jev", ...req })).answers.step.probabilities; }
      catch (e) { probs = e?.data?.step?.probabilities; if (!probs) await new Promise((r) => setTimeout(r, 1500)); }
    }
    const order = Object.entries(probs).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const rank = order.findIndex((id) => j.good.has(id)) + 1;
    (results[j.stage.id] ??= []).push({ rank, good: j.good.size, n: j.n });
  }
}));
for (const [id, rs] of Object.entries(results)) {
  const chance = rs.reduce((s, r) => s + r.good / r.n, 0) / rs.length;
  console.log(id.padEnd(15), `top1 ${rs.filter((r) => r.rank === 1).length}/${rs.length}  top3 ${rs.filter((r) => r.rank <= 3).length}/${rs.length}  ranks ${rs.map((r) => r.rank).join(",")}  (menu ${rs[0].n}, chance of a random top1 ${(chance * 100).toFixed(0)}%)`);
}
