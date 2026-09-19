// Jev runs the beginner's method on real 20-move scrambles. --ranker=random swaps Jev for coin flips
// under the same search, to show how much of the solve is Jev's judgment.
import { experimental_evaluate as evaluate } from "ai";
import { appendFileSync } from "node:fs";
import { SOLVED_CUBE, applyMoves, serializeCube } from "../app/cube.ts";
import { STAGES } from "../app/method.ts";
import { stepRequest } from "../app/prompts.ts";
import { demoScramble, solveWithMethod } from "../app/solver.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const n = Number(args.n ?? 3), ranker = args.ranker ?? "jev", seed0 = Number(args.seed ?? 100);
const width = Number(args.width ?? 3), conc = Number(args.conc ?? 2), length = Number(args.len ?? 20);
const out = args.out ?? "results/method-results.jsonl";

function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }

async function askJev(stickers, stage, macros, check, attempt = 0) {
  const req = stepRequest(stickers, stage, macros, check);
  try {
    const r = await evaluate({ model: "typesafe-ai/jev", ...req, maxRetries: 0, abortSignal: AbortSignal.timeout(20000) });
    return { probabilities: r.answers.step.probabilities ?? { [r.answers.step.choice]: 1 }, tokens: r.usage.inputTokens ?? 0 };
  } catch (e) {
    if (e?.data?.step?.probabilities) return { probabilities: e.data.step.probabilities, tokens: 0 };
    if (attempt < 16) { await new Promise((r) => setTimeout(r, Math.min(15000, 500 * 2 ** attempt))); return askJev(stickers, stage, macros, check, attempt + 1); }
    throw e;
  }
}
function askRandom(r) {
  return async (stickers, stage, macros) => {
    const w = macros.map(() => r());
    const sum = w.reduce((a, b) => a + b, 0);
    return { probabilities: Object.fromEntries(macros.map((m, i) => [m.id, w[i] / sum])), tokens: 0 };
  };
}

// --from=<stage id>: finish earlier stages with an exhaustive search first, so later stages can be measured alone.
const key = (s) => Object.values(serializeCube(s)).join("");
function bfs(start, stage, check, maxDepth = 4) {
  if (check(start)) return start;
  let frontier = [start]; const seen = new Set([key(start)]);
  for (let d = 1; d <= maxDepth; d++) {
    const next = [];
    for (const s of frontier) for (const m of stage.macros) { const c = applyMoves(s, m.moves); const k = key(c); if (seen.has(k)) continue; seen.add(k); if (check(c)) return c; next.push(c); }
    frontier = next;
  }
  throw new Error("bfs failed");
}
function prefill(s) {
  if (!args.from) return s;
  for (const stage of STAGES) { if (stage.id === args.from) break; for (const check of stage.checks) s = bfs(s, stage, check); }
  return s;
}

async function run(i) {
  const seed = seed0 + i;
  const scramble = demoScramble(length, rng(seed));
  const t = Date.now();
  const ask = ranker === "jev" ? askJev : askRandom(rng(seed * 31));
  const stages = args.only ? STAGES.filter((s) => args.only.split(",").includes(s.id)) : STAGES;
  const res = await solveWithMethod(prefill(applyMoves(SOLVED_CUBE, scramble)), ask, { width, stages });
  const moves = res.steps.reduce((s, st) => s + st.macro.moves.length, 0);
  const top = res.steps.filter((s) => s.topChoice).length;
  const row = { ranker, width, seed, scramble: scramble.join(" "), solved: res.solved, failedStage: res.failedStage ?? null, calls: res.calls, tokens: res.tokens, steps: res.steps.length, topChoiceSteps: top, moves, seconds: (Date.now() - t) / 1000 };
  appendFileSync(out, JSON.stringify(row) + "\n");
  console.log(`${row.solved ? "SOLVED" : "failed"} seed=${seed} calls=${row.calls} steps=${row.steps} (top-choice ${top}) moves=${moves} ${row.seconds}s${row.failedStage ? " stuck at " + row.failedStage : ""}`);
  return row;
}
const rows = []; let next = 0;
await Promise.all(Array.from({ length: Math.min(conc, n) }, async () => { while (next < n) rows.push(await run(next++)); }));
const solved = rows.filter((r) => r.solved);
const tok = rows.reduce((s, r) => s + r.tokens, 0);
console.log(`\n${ranker} width ${width}: ${solved.length}/${n} solved | mean calls ${(rows.reduce((s, r) => s + r.calls, 0) / n).toFixed(0)} | mean moves ${(solved.reduce((s, r) => s + r.moves, 0) / Math.max(1, solved.length)).toFixed(0)} | tokens ${tok} ~$${(tok * 0.042e-6).toFixed(4)}`);
